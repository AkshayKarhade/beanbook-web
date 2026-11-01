-- Published menus are editable without changing their URL. Counter checkout needs business-owned payment details.
-- The original draft menu RPC is replaced to permit published menus as well.
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
   and e.sales_mode in ('regular','event') and e.status in ('draft','published')
 for update;
 if not found then
  raise exception 'Only your owned draft or published menus can be edited' using errcode='22023';
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

create table if not exists public.business_payment_settings(
 brand_id uuid primary key references public.brands(id) on delete cascade,
 upi_vpa text not null check(upi_vpa ~* '^[a-z0-9._-]{2,100}@[a-z0-9.-]{2,64}$'),
 payee_name text not null check(length(btrim(payee_name)) between 2 and 120),
 updated_at timestamptz not null default now()
);
alter table public.business_payment_settings enable row level security;
revoke all on public.business_payment_settings from anon,authenticated;
grant select,insert,update on public.business_payment_settings to service_role;

-- An authoritative JSON receipt avoids trusting the amount calculated by the frontend.
create or replace function public.beanbook_create_counter_order_v2(
 p_brand_id uuid,p_menu_id uuid,p_name text,p_phone text,p_items jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 return jsonb_build_object('orderNumber',v_number,'amount',v_total,'orderId',v_order);
end;
$$;
revoke all on function public.beanbook_create_counter_order_v2(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.beanbook_create_counter_order_v2(uuid,uuid,text,text,jsonb) to service_role;

create table if not exists public.counter_payment_confirmations(
 order_id uuid primary key references public.orders(id),
 brand_id uuid not null references public.brands(id),
 confirmed_by uuid not null references auth.users(id),
 payment_method text not null check(payment_method in ('upi','cash')),
 transaction_reference text,
 confirmed_at timestamptz not null default now()
);
alter table public.counter_payment_confirmations enable row level security;
revoke all on public.counter_payment_confirmations from anon,authenticated;
grant select,insert on public.counter_payment_confirmations to service_role;

create or replace function public.beanbook_confirm_counter_payment(
 p_brand_id uuid, p_order_number text, p_staff_user uuid, p_payment_method text,
 p_reference text
) returns text
language plpgsql security invoker set search_path=''
as $$
declare v_order public.orders%rowtype;
begin
 if not exists(select 1 from public.admin_users a where a.supabase_user_id=p_staff_user and a.brand_id=p_brand_id and a.role in ('owner','staff')) then
  raise exception 'Not authorized to confirm payments for this business' using errcode='22023';
 end if;
 if p_payment_method not in ('upi','cash') then
  raise exception 'Invalid payment method' using errcode='22023';
 end if;
 if p_payment_method='upi' and (p_reference is null or p_reference !~ '^[A-Za-z0-9-]{8,35}$') then
  raise exception 'Enter the verified UPI transaction reference (8–35 characters)' using errcode='22023';
 end if;
 if length(coalesce(p_reference,''))>60 then
  raise exception 'Reference too long' using errcode='22023';
 end if;
 select * into v_order from public.orders
 where brand_id=p_brand_id and order_number=p_order_number and order_channel='counter'
 for update;
 if not found then raise exception 'Counter order not found' using errcode='22023'; end if;
 if v_order.payment_status<>'pending' or v_order.paid_at is not null then
  raise exception 'This order is no longer awaiting payment' using errcode='22023';
 end if;
 insert into public.counter_payment_confirmations(order_id,brand_id,confirmed_by,payment_method,transaction_reference)
 values(v_order.id,p_brand_id,p_staff_user,p_payment_method,nullif(btrim(coalesce(p_reference,'')),''));
 update public.orders set payment_status='paid',paid_at=now() where id=v_order.id;
 return 'paid';
end;
$$;
revoke all on function public.beanbook_confirm_counter_payment(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.beanbook_confirm_counter_payment(uuid,text,uuid,text,text) to service_role;
