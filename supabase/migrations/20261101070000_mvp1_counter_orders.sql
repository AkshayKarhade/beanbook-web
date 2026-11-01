-- Counter POS: price-authoritative, atomic untracked product orders.
-- Historic orders are never deleted by menu removal.
alter table public.orders add column if not exists order_channel text;
alter table public.orders add constraint orders_channel_check check(order_channel is null or order_channel in ('counter','self'));
alter table public.order_items add column if not exists size_name text;
create table if not exists public.order_item_addons(
 id uuid primary key default gen_random_uuid(),
 order_item_id uuid not null references public.order_items(id) on delete cascade,
 addon_id uuid not null references public.product_addons(id),
 addon_name text not null,
 unit_price numeric(12,2) not null check(unit_price>=0)
);
alter table public.order_item_addons enable row level security;
revoke all on public.order_item_addons from anon,authenticated;
grant select,insert,update on public.order_item_addons to service_role;

create or replace function public.beanbook_create_counter_order(
 p_brand_id uuid,p_menu_id uuid,p_name text,p_phone text,p_items jsonb
) returns text language plpgsql security invoker set search_path='' as $$
declare
 v_menu public.events%rowtype;
 v_customer uuid;
 v_order uuid;
 v_number text;
 v_item jsonb;
 v_addon text;
 v_product uuid;
 v_size text;
 v_qty int;
 v_unit numeric;
 v_addon_price numeric;
 v_addon_name text;
 v_line uuid;
 v_total numeric:=0;
 v_seen text[]:='{}';
 v_subtotal numeric;
 v_addon_id uuid;
begin
 select * into v_menu from public.events where id=p_menu_id and brand_id=p_brand_id and status='published' and sales_mode in ('regular','event') for share;
 if not found then raise exception 'Menu unavailable' using errcode='22023'; end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 120 or coalesce(p_phone,'') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Customer name and phone are required' using errcode='22023'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'Invalid basket' using errcode='22023'; end if;
 if v_menu.sales_mode='event' and (v_menu.event_start_date>current_date or v_menu.event_end_date<current_date) then raise exception 'Event not currently active' using errcode='22023'; end if;
 -- Row-level serialization prevents ambiguity in simultaneous assignments.
 insert into public.customers(brand_id,name,phone) values(p_brand_id,btrim(p_name),p_phone) returning id into v_customer;
 v_number:='BB-POS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 insert into public.orders(brand_id,event_id,customer_id,order_number,total_amount,payment_status,order_status,order_channel)
 values(p_brand_id,p_menu_id,v_customer,v_number,0,'pending','preparing','counter') returning id into v_order;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if coalesce(v_item->>'product_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'Invalid product' using errcode='22023'; end if;
  v_product:=(v_item->>'product_id')::uuid;
  if coalesce(v_item->>'quantity','') !~ '^[0-9]{1,2}$' then raise exception 'Invalid quantity' using errcode='22023'; end if;
  v_qty:=(v_item->>'quantity')::integer;
  if v_qty<1 or v_qty>20 then raise exception 'Invalid quantity' using errcode='22023'; end if;
  v_size:=nullif(btrim(coalesce(v_item->>'size_name','')),'');
  select coalesce(ep.price_override,p.price) into v_unit
  from public.event_products ep join public.products p on p.id=ep.product_id
  where ep.event_id=p_menu_id and ep.product_id=v_product and p.brand_id=p_brand_id and ep.is_available and p.is_active and not ep.inventory_tracking;
  if not found then raise exception 'Unavailable or inventory-tracked item; reservations are not ready' using errcode='22023'; end if;
  if exists(select 1 from public.product_sizes ps where ps.product_id=v_product and ps.brand_id=p_brand_id) then
    if v_size is null then raise exception 'Choose a size' using errcode='22023'; end if;
    select coalesce(sp.price,ps.price) into v_unit
    from public.product_sizes ps join public.event_products ep on ep.event_id=p_menu_id and ep.product_id=ps.product_id
    left join public.event_product_size_prices sp on sp.event_product_id=ep.id and sp.size_name=ps.name
    where ps.product_id=v_product and ps.brand_id=p_brand_id and ps.name=v_size;
    if not found then raise exception 'Invalid size' using errcode='22023'; end if;
  elsif v_size is not null then raise exception 'Product has no sizes' using errcode='22023'; end if;
  v_subtotal:=v_unit;
  if jsonb_typeof(coalesce(v_item->'addon_ids','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(v_item->'addon_ids','[]'::jsonb))>12 then raise exception 'Invalid add-ons' using errcode='22023'; end if;
  v_seen:='{}';
  for v_addon in select value #>> '{}' from jsonb_array_elements(coalesce(v_item->'addon_ids','[]'::jsonb)) loop
   if v_addon !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or v_addon=any(v_seen) then raise exception 'Invalid add-on' using errcode='22023'; end if;
   v_seen:=array_append(v_seen,v_addon);
   v_addon_id:=v_addon::uuid;
   select pa.name,ap.price into v_addon_name,v_addon_price from public.product_addons pa
    join public.product_allowed_addons link on link.addon_id=pa.id and link.product_id=v_product and link.brand_id=p_brand_id
    join public.product_addon_prices ap on ap.addon_id=pa.id and ap.brand_id=p_brand_id and lower(ap.size_name)=lower(coalesce(v_size,'standard'))
    where pa.id=v_addon_id and pa.brand_id=p_brand_id and pa.is_active;
   if not found then raise exception 'Unavailable add-on or missing size price' using errcode='22023'; end if;
   v_subtotal:=v_subtotal+v_addon_price;
  end loop;
  insert into public.order_items(order_id,product_id,quantity,unit_price,size_name) values(v_order,v_product,v_qty,v_subtotal,v_size) returning id into v_line;
  for v_addon in select value #>> '{}' from jsonb_array_elements(coalesce(v_item->'addon_ids','[]'::jsonb)) loop
   select pa.name,ap.price into v_addon_name,v_addon_price from public.product_addons pa join public.product_addon_prices ap on ap.addon_id=pa.id and ap.brand_id=p_brand_id and lower(ap.size_name)=lower(coalesce(v_size,'standard')) where pa.id=v_addon::uuid;
   insert into public.order_item_addons(order_item_id,addon_id,addon_name,unit_price) values(v_line,v_addon::uuid,v_addon_name,v_addon_price);
  end loop;
  v_total:=v_total+v_subtotal*v_qty;
 end loop;
 update public.orders set total_amount=v_total where id=v_order;
 return v_number;
end;
$$;
revoke all on function public.beanbook_create_counter_order(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.beanbook_create_counter_order(uuid,uuid,text,text,jsonb) to service_role;
