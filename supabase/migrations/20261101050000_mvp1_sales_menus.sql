-- MVP-1 Events & Menus: additive support for draft regular/event menus.
-- Existing event/order/CRAG/Direct Sales rows remain 'legacy' and are untouched.
alter table public.events
 add column if not exists sales_mode text not null default 'legacy';
alter table public.events
 add constraint events_sales_mode_check check(sales_mode in ('legacy','regular','event'));
create unique index if not exists events_one_regular_menu_per_business
 on public.events(brand_id) where sales_mode='regular';

alter table public.event_products
 add column if not exists inventory_tracking boolean not null default false;

create table if not exists public.event_product_size_prices(
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null references public.brands(id) on delete cascade,
 event_product_id uuid not null references public.event_products(id) on delete cascade,
 size_name text not null check(length(btrim(size_name)) between 1 and 60),
 price numeric(12,2) not null check(price > 0 and price <= 100000),
 unique(event_product_id,size_name)
);
create index if not exists event_product_size_prices_brand_idx
 on public.event_product_size_prices(brand_id,event_product_id);
alter table public.event_product_size_prices enable row level security;
revoke all on public.event_product_size_prices from anon,authenticated;
grant select,insert,update,delete on public.event_product_size_prices to service_role;
-- Old event endpoints read only; the new owner-only admin endpoint needs mutations.
grant insert,update on public.events to service_role;

create or replace function public.beanbook_save_draft_menu_items(
 p_brand_id uuid,p_event_id uuid,p_items jsonb
) returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
 v_mode text;
 v_item jsonb;
 v_product_id uuid;
 v_event_product_id uuid;
 v_override numeric;
 v_size_count integer;
 v_size record;
 v_price numeric;
 v_seen uuid[] := '{}';
 v_count integer := 0;
 v_size_overrides jsonb;
begin
 select e.sales_mode into v_mode
 from public.events e
 where e.id=p_event_id and e.brand_id=p_brand_id
   and e.sales_mode in ('regular','event') and e.status='draft'
 for update;
 if not found then
  raise exception 'Only your draft menus can be edited' using errcode='22023';
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)>80 then
  raise exception 'Invalid menu item list' using errcode='22023';
 end if;

 -- One atomic replacement of the draft menu; failures roll back all changes.
 delete from public.event_products where event_id=p_event_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(v_item)<>'object'
     or coalesce(v_item->>'product_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    raise exception 'Invalid product identifier' using errcode='22023';
  end if;
  v_product_id := (v_item->>'product_id')::uuid;
  if v_product_id = any(v_seen) then
   raise exception 'Duplicate menu product' using errcode='22023';
  end if;
  v_seen := array_append(v_seen,v_product_id);
  if not exists(select 1 from public.products p
                where p.id=v_product_id and p.brand_id=p_brand_id and p.is_active) then
   raise exception 'Menu products must be active and belong to your business' using errcode='22023';
  end if;
  select count(*) into v_size_count
  from public.product_sizes s where s.product_id=v_product_id and s.brand_id=p_brand_id;
  v_size_overrides := coalesce(v_item->'size_overrides','{}'::jsonb);
  if jsonb_typeof(v_size_overrides)<>'object' then
   raise exception 'Invalid size overrides' using errcode='22023';
  end if;
  if v_mode='regular' and (v_item->>'price_override' is not null or v_size_overrides<>'{}'::jsonb) then
   raise exception 'Regular menus use product catalogue prices' using errcode='22023';
  end if;
  if v_size_count>0 and v_item->>'price_override' is not null then
   raise exception 'Sized products require individual size price overrides' using errcode='22023';
  end if;
  if v_size_count=0 and v_size_overrides<>'{}'::jsonb then
   raise exception 'Single-price products cannot use size overrides' using errcode='22023';
  end if;

  v_override:=null;
  if v_item->>'price_override' is not null then
   if (v_item->>'price_override') !~ '^[0-9]+([.][0-9]{1,2})?$' then
    raise exception 'Invalid price override' using errcode='22023';
   end if;
   v_override := (v_item->>'price_override')::numeric;
   if v_override<=0 or v_override>100000 then
    raise exception 'Price override outside permitted range' using errcode='22023';
   end if;
  end if;

  insert into public.event_products(event_id,product_id,is_available,display_order,price_override,inventory_tracking)
  values (p_event_id,v_product_id,true,v_count,v_override,coalesce((v_item->>'track_inventory')::boolean,false))
  returning id into v_event_product_id;

  for v_size in select key,value from jsonb_each_text(v_size_overrides) loop
   if not exists(select 1 from public.product_sizes s
                 where s.product_id=v_product_id and s.brand_id=p_brand_id
                   and s.name=v_size.key) then
    raise exception 'Price override refers to an unavailable size' using errcode='22023';
   end if;
   if v_size.value !~ '^[0-9]+([.][0-9]{1,2})?$' then
    raise exception 'Invalid size override price' using errcode='22023';
   end if;
   v_price:=v_size.value::numeric;
   if v_price<=0 or v_price>100000 then
    raise exception 'Invalid size override price' using errcode='22023';
   end if;
   insert into public.event_product_size_prices(brand_id,event_product_id,size_name,price)
   values(p_brand_id,v_event_product_id,v_size.key,v_price);
  end loop;
  v_count := v_count + 1;
 end loop;
 return v_count;
end;
$$;
revoke all on function public.beanbook_save_draft_menu_items(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.beanbook_save_draft_menu_items(uuid,uuid,jsonb) to service_role;
