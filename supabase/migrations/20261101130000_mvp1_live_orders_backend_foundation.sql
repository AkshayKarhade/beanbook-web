-- BeanBook MVP-1: non-deployed backend foundation for versioned counter bills.
-- IMPORTANT: review and apply only to a verified isolated Supabase environment.
-- Existing orders remain legacy (workflow_version NULL); no historical backfill.
-- The live Razorpay finalize_paid_order function is intentionally unchanged.

create table public.business_billing_settings (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  billing_mode text not null default 'pay_first'
    check (billing_mode in ('pay_first','open_bill')),
  updated_at timestamptz not null default now()
);
alter table public.business_billing_settings enable row level security;
revoke all on public.business_billing_settings from public, anon, authenticated;
grant select,insert,update on public.business_billing_settings to service_role;

alter table public.orders
  add column workflow_version smallint,
  add column billing_mode text,
  add column billing_status text,
  add constraint beanbook_billing_mode_check
    check (billing_mode is null or billing_mode in ('pay_first','open_bill')),
  add constraint beanbook_billing_status_check
    check (billing_status is null or billing_status in ('open','settlement_in_progress','settled','voided')),
  add constraint beanbook_workflow_version_check
    check (workflow_version is null or workflow_version = 2);

alter table public.order_items
  add column fulfillment_status text,
  add column round_number integer,
  add column cancelled_at timestamptz,
  add constraint beanbook_item_fulfillment_check
    check (fulfillment_status is null or fulfillment_status in ('received','preparing','ready','completed','cancelled')),
  add constraint beanbook_item_round_check
    check (round_number is null or round_number > 0);

create table public.beanbook_order_activity (
  id bigint generated always as identity primary key,
  brand_id uuid not null references public.brands(id),
  order_id uuid not null references public.orders(id),
  order_item_id uuid references public.order_items(id),
  actor_user_id uuid references auth.users(id),
  operation text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index beanbook_order_activity_order_idx on public.beanbook_order_activity(order_id,created_at);
alter table public.beanbook_order_activity enable row level security;
revoke all on public.beanbook_order_activity from public, anon, authenticated;
grant select,insert on public.beanbook_order_activity to service_role;

create table public.beanbook_order_request_keys (
  brand_id uuid not null references public.brands(id),
  operation text not null,
  request_id uuid not null,
  order_id uuid references public.orders(id),
  payload_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key(brand_id,operation,request_id)
);
alter table public.beanbook_order_request_keys enable row level security;
revoke all on public.beanbook_order_request_keys from public, anon, authenticated;
grant select,insert,update on public.beanbook_order_request_keys to service_role;

-- A previously permissive policy allowed ANY visitor to read ANY order.
-- All existing public self-order flows use server-side service-role APIs.
drop policy if exists "Enable read access for all users" on public.orders;
revoke insert,update,delete on public.orders from anon, authenticated;
revoke insert,update,delete on public.order_items from anon, authenticated;

-- Protect settled order totals, identity and billing snapshots even against
-- accidental privileged application code updates.
create function public.beanbook_guard_bill_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.workflow_version = 2 then
    if new.workflow_version is distinct from old.workflow_version
       or new.billing_mode is distinct from old.billing_mode
       or new.brand_id is distinct from old.brand_id
       or new.event_id is distinct from old.event_id
       or new.customer_id is distinct from old.customer_id then
      raise exception 'Immutable bill identity or policy' using errcode='22023';
    end if;
    if (old.billing_status in ('settlement_in_progress','settled','voided')
        or old.payment_status in ('paid','paid_stock_issue')
        or old.paid_at is not null)
       and new.total_amount is distinct from old.total_amount then
      raise exception 'Bill amount is locked' using errcode='22023';
    end if;
    if old.billing_status in ('settled','voided') and new.billing_status is distinct from old.billing_status then
      raise exception 'Settled or voided bill cannot be reopened' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger beanbook_guard_bill_update
before update on public.orders for each row execute function public.beanbook_guard_bill_update();

create function public.beanbook_guard_item_mutation()
returns trigger language plpgsql set search_path='' as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id=coalesce(new.order_id,old.order_id) for update;
  if not found then raise exception 'Order not found' using errcode='22023'; end if;
  if v_order.workflow_version = 2 then
    if v_order.billing_status in ('settlement_in_progress','settled','voided')
       or v_order.payment_status in ('paid','paid_stock_issue')
       or v_order.paid_at is not null then
      if tg_op <> 'UPDATE'
         or (new.quantity,new.product_id,new.unit_price,new.size_name,new.order_id,new.fulfillment_status,new.cancelled_at)
            is distinct from
            (old.quantity,old.product_id,old.unit_price,old.size_name,old.order_id,old.fulfillment_status,old.cancelled_at) then
        -- Fulfillment-only updates on paid orders are performed by a separate
        -- path; finance columns remain immutable.
        if tg_op <> 'UPDATE'
           or (new.quantity,new.product_id,new.unit_price,new.size_name,new.order_id,new.cancelled_at)
              is distinct from
              (old.quantity,old.product_id,old.unit_price,old.size_name,old.order_id,old.cancelled_at) then
          raise exception 'Bill items locked for settlement or payment' using errcode='22023';
        end if;
      end if;
    end if;
    if tg_op='DELETE' then
      raise exception 'Cancel bill lines; never delete their audit history' using errcode='22023';
    end if;
    if tg_op='UPDATE' and
       (new.quantity,new.product_id,new.unit_price,new.size_name,new.order_id,new.round_number)
       is distinct from (old.quantity,old.product_id,old.unit_price,old.size_name,old.order_id,old.round_number) then
      raise exception 'Use a new priced line for changes' using errcode='22023';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger beanbook_guard_item_mutation
before insert or update or delete on public.order_items
for each row execute function public.beanbook_guard_item_mutation();

-- Called exclusively through a verified staff endpoint and service_role.
create function public.beanbook_assert_order_staff(p_brand_id uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_brand_id is null or p_actor is null or not exists (
    select 1 from public.admin_users
    where supabase_user_id=p_actor and brand_id=p_brand_id and role in ('owner','staff')
  ) then
    raise exception 'Business staff access required' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.beanbook_assert_order_staff(uuid,uuid) from public,anon,authenticated;
grant execute on function public.beanbook_assert_order_staff(uuid,uuid) to service_role;

-- Existing v2 is the authoritative pricing engine for initial baskets.
-- v3 adds a durable idempotency key and snapshots the business billing policy.
create function public.beanbook_create_counter_order_v3(
  p_brand_id uuid,p_menu_id uuid,p_name text,p_phone text,p_items jsonb,
  p_actor uuid,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_hash text;
  v_key public.beanbook_order_request_keys%rowtype;
  v_receipt jsonb;
  v_mode text;
  v_order_id uuid;
begin
  perform public.beanbook_assert_order_staff(p_brand_id,p_actor);
  if p_request_id is null then raise exception 'Idempotency key required' using errcode='22023'; end if;
  v_hash:=md5(jsonb_build_object('menu',p_menu_id,'name',p_name,'phone',p_phone,'items',p_items)::text);
  insert into public.beanbook_order_request_keys(brand_id,operation,request_id,payload_hash)
  values(p_brand_id,'create_counter',p_request_id,v_hash) on conflict do nothing;
  select * into v_key from public.beanbook_order_request_keys
    where brand_id=p_brand_id and operation='create_counter' and request_id=p_request_id for update;
  if v_key.payload_hash<>v_hash then raise exception 'Idempotency key reused with a different cart' using errcode='22023'; end if;
  if v_key.response is not null then return v_key.response; end if;
  select coalesce((select billing_mode from public.business_billing_settings where brand_id=p_brand_id),'pay_first') into v_mode;
  v_receipt:=public.beanbook_create_counter_order_v2(p_brand_id,p_menu_id,p_name,p_phone,p_items);
  v_order_id:=(v_receipt->>'orderId')::uuid;
  update public.orders set workflow_version=2,billing_mode=v_mode,billing_status='open',order_status='received'
    where id=v_order_id and brand_id=p_brand_id;
  update public.order_items set fulfillment_status='received',round_number=1 where order_id=v_order_id;
  v_receipt:=v_receipt||jsonb_build_object('billingMode',v_mode,'billingStatus','open');
  update public.beanbook_order_request_keys set order_id=v_order_id,response=v_receipt
    where brand_id=p_brand_id and operation='create_counter' and request_id=p_request_id;
  insert into public.beanbook_order_activity(brand_id,order_id,actor_user_id,operation,metadata)
    values(p_brand_id,v_order_id,p_actor,'created',jsonb_build_object('billing_mode',v_mode,'total',v_receipt->'amount'));
  return v_receipt;
end;
$$;
revoke all on function public.beanbook_create_counter_order_v3(uuid,uuid,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.beanbook_create_counter_order_v3(uuid,uuid,text,text,jsonb,uuid,uuid) to service_role;

-- Authoritative append-only pricing for new preparation rounds.
-- Inventory-tracked menu lines remain disallowed until reservations exist.
create function public.beanbook_insert_priced_bill_items(
  p_brand_id uuid,p_menu_id uuid,p_order_id uuid,p_items jsonb,p_round integer
) returns numeric language plpgsql security invoker set search_path='' as $$
declare
  v_item jsonb; v_product uuid; v_qty integer; v_size text; v_price numeric;
  v_addon text; v_addon_id uuid; v_addon_name text; v_addon_price numeric;
  v_seen text[]; v_line uuid; v_line_total numeric; v_total numeric:=0;
begin
  if p_items is null or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Invalid basket' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item)<>'object'
       or coalesce(v_item->>'product_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       or coalesce(v_item->>'quantity','') !~ '^[0-9]{1,2}$' then
      raise exception 'Invalid product or quantity' using errcode='22023';
    end if;
    v_product:=(v_item->>'product_id')::uuid;
    v_qty:=(v_item->>'quantity')::int;
    if v_qty not between 1 and 20 then raise exception 'Invalid quantity' using errcode='22023'; end if;
    v_size:=nullif(btrim(coalesce(v_item->>'size_name','')),'');
    select coalesce(ep.price_override,p.price) into v_price
    from public.event_products ep join public.products p on p.id=ep.product_id
    where ep.event_id=p_menu_id and ep.product_id=v_product and p.brand_id=p_brand_id
      and p.is_active and ep.is_available and not ep.inventory_tracking;
    if not found then raise exception 'Unavailable or inventory-tracked item' using errcode='22023'; end if;
    if exists(select 1 from public.product_sizes where product_id=v_product and brand_id=p_brand_id) then
      if v_size is null then raise exception 'Choose a size' using errcode='22023'; end if;
      select coalesce(spp.price,ps.price) into v_price from public.product_sizes ps
      join public.event_products ep on ep.event_id=p_menu_id and ep.product_id=ps.product_id
      left join public.event_product_size_prices spp on spp.event_product_id=ep.id and spp.size_name=ps.name
      where ps.product_id=v_product and ps.brand_id=p_brand_id and ps.name=v_size;
      if not found then raise exception 'Invalid size' using errcode='22023'; end if;
    elsif v_size is not null then
      raise exception 'This product has no sizes' using errcode='22023';
    end if;
    if jsonb_typeof(coalesce(v_item->'addon_ids','[]'::jsonb))<>'array'
      or jsonb_array_length(coalesce(v_item->'addon_ids','[]'::jsonb))>12 then
      raise exception 'Invalid add-ons' using errcode='22023';
    end if;
    v_seen:='{}';
    v_line_total:=v_price;
    for v_addon in select value #>> '{}' from jsonb_array_elements(coalesce(v_item->'addon_ids','[]'::jsonb)) loop
      if v_addon !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
         or v_addon=any(v_seen) then raise exception 'Duplicate or invalid add-on' using errcode='22023'; end if;
      v_seen:=array_append(v_seen,v_addon);
      v_addon_id:=v_addon::uuid;
      select a.name,ap.price into v_addon_name,v_addon_price from public.product_addons a
      join public.product_allowed_addons link on link.addon_id=a.id and link.product_id=v_product and link.brand_id=p_brand_id
      join public.product_addon_prices ap on ap.addon_id=a.id and ap.brand_id=p_brand_id
        and lower(ap.size_name)=lower(coalesce(v_size,'standard'))
      where a.id=v_addon_id and a.brand_id=p_brand_id and a.is_active;
      if not found then raise exception 'Unavailable add-on' using errcode='22023'; end if;
      v_line_total:=v_line_total+v_addon_price;
    end loop;
    if v_line_total<=0 or v_line_total>100000 or v_line_total<>round(v_line_total,2) then
      raise exception 'Invalid authoritative price' using errcode='22023';
    end if;
    insert into public.order_items(order_id,product_id,quantity,unit_price,size_name,fulfillment_status,round_number)
      values(p_order_id,v_product,v_qty,v_line_total,v_size,'received',p_round) returning id into v_line;
    for v_addon in select value #>> '{}' from jsonb_array_elements(coalesce(v_item->'addon_ids','[]'::jsonb)) loop
      select a.name,ap.price into v_addon_name,v_addon_price
      from public.product_addons a join public.product_addon_prices ap on ap.addon_id=a.id and ap.brand_id=p_brand_id
        and lower(ap.size_name)=lower(coalesce(v_size,'standard')) where a.id=v_addon::uuid;
      insert into public.order_item_addons(order_item_id,addon_id,addon_name,unit_price)
        values(v_line,v_addon::uuid,v_addon_name,v_addon_price);
    end loop;
    v_total:=v_total+v_line_total*v_qty;
  end loop;
  return v_total;
end;
$$;
revoke all on function public.beanbook_insert_priced_bill_items(uuid,uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.beanbook_insert_priced_bill_items(uuid,uuid,uuid,jsonb,integer) to service_role;

create function public.beanbook_add_open_bill_items(
  p_brand_id uuid,p_order_id uuid,p_actor uuid,p_request_id uuid,p_items jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_order public.orders%rowtype; v_key public.beanbook_order_request_keys%rowtype;
  v_hash text; v_round int; v_amount numeric; v_response jsonb;
begin
  perform public.beanbook_assert_order_staff(p_brand_id,p_actor);
  if p_request_id is null or p_items is null then raise exception 'Request key and basket required' using errcode='22023'; end if;
  select * into v_order from public.orders where id=p_order_id and brand_id=p_brand_id for update;
  if not found then raise exception 'Order not found' using errcode='22023'; end if;
  v_hash:=md5(p_items::text);
  insert into public.beanbook_order_request_keys(brand_id,operation,request_id,order_id,payload_hash)
    values(p_brand_id,'add_items',p_request_id,p_order_id,v_hash) on conflict do nothing;
  select * into v_key from public.beanbook_order_request_keys
    where brand_id=p_brand_id and operation='add_items' and request_id=p_request_id for update;
  if v_key.payload_hash<>v_hash or v_key.order_id is distinct from p_order_id then
    raise exception 'Idempotency key reused for another bill or basket' using errcode='22023';
  end if;
  if v_key.response is not null then return v_key.response; end if;
  if v_order.workflow_version is distinct from 2 or v_order.order_channel<>'counter'
     or v_order.billing_mode<>'open_bill' or v_order.billing_status<>'open'
     or v_order.payment_status<>'pending' or v_order.paid_at is not null
     or v_order.razorpay_order_id is not null then
    raise exception 'This bill is not editable' using errcode='22023';
  end if;
  select coalesce(max(round_number),0)+1 into v_round from public.order_items where order_id=p_order_id;
  perform public.beanbook_insert_priced_bill_items(p_brand_id,v_order.event_id,p_order_id,p_items,v_round);
  select coalesce(sum(quantity*unit_price),0) into v_amount
    from public.order_items where order_id=p_order_id and fulfillment_status<>'cancelled';
  update public.orders set total_amount=v_amount where id=p_order_id;
  v_response:=jsonb_build_object('orderId',p_order_id,'amount',v_amount,'round',v_round);
  update public.beanbook_order_request_keys set response=v_response
    where brand_id=p_brand_id and operation='add_items' and request_id=p_request_id;
  insert into public.beanbook_order_activity(brand_id,order_id,actor_user_id,operation,metadata)
    values(p_brand_id,p_order_id,p_actor,'items_added',jsonb_build_object('round',v_round,'total',v_amount));
  return v_response;
end;
$$;
revoke all on function public.beanbook_add_open_bill_items(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.beanbook_add_open_bill_items(uuid,uuid,uuid,uuid,jsonb) to service_role;

create function public.beanbook_change_item_fulfillment(
  p_brand_id uuid,p_order_item_id uuid,p_actor uuid,p_next text
) returns text language plpgsql security invoker set search_path='' as $$
declare v_order public.orders%rowtype; v_item public.order_items%rowtype;
begin
  perform public.beanbook_assert_order_staff(p_brand_id,p_actor);
  select o.* into v_order from public.orders o join public.order_items i on i.order_id=o.id
    where i.id=p_order_item_id and o.brand_id=p_brand_id for update of o;
  if not found or v_order.workflow_version is distinct from 2
    or v_order.billing_status='voided' then
    raise exception 'Order not available for fulfillment' using errcode='22023';
  end if;
  if v_order.billing_mode='pay_first' and v_order.payment_status<>'paid' then
    raise exception 'Pay-first order must be paid before preparation' using errcode='22023';
  end if;
  if v_order.billing_mode='open_bill' and v_order.billing_status not in ('open','settlement_in_progress','settled') then
    raise exception 'Open bill is not active' using errcode='22023';
  end if;
  select * into v_item from public.order_items where id=p_order_item_id for update;
  if v_item.fulfillment_status=p_next then return p_next; end if;
  if not ((v_item.fulfillment_status='received' and p_next='preparing')
    or (v_item.fulfillment_status='preparing' and p_next='ready')
    or (v_item.fulfillment_status='ready' and p_next='completed')) then
    raise exception 'Invalid item preparation transition' using errcode='22023';
  end if;
  update public.order_items set fulfillment_status=p_next where id=p_order_item_id;
  insert into public.beanbook_order_activity(brand_id,order_id,order_item_id,actor_user_id,operation,metadata)
    values(p_brand_id,v_order.id,p_order_item_id,p_actor,'fulfillment_advanced',
      jsonb_build_object('from',v_item.fulfillment_status,'to',p_next));
  return p_next;
end;
$$;
revoke all on function public.beanbook_change_item_fulfillment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.beanbook_change_item_fulfillment(uuid,uuid,uuid,text) to service_role;

create function public.beanbook_cancel_open_bill_item(
  p_brand_id uuid,p_order_item_id uuid,p_actor uuid,p_reason text
) returns numeric language plpgsql security invoker set search_path='' as $$
declare v_order public.orders%rowtype; v_item public.order_items%rowtype; v_amount numeric;
begin
  perform public.beanbook_assert_order_staff(p_brand_id,p_actor);
  if length(btrim(coalesce(p_reason,''))) not between 5 and 300 then
    raise exception 'Cancellation reason required (5-300 characters)' using errcode='22023';
  end if;
  select o.* into v_order from public.orders o join public.order_items i on i.order_id=o.id
    where i.id=p_order_item_id and o.brand_id=p_brand_id for update of o;
  if not found or v_order.workflow_version is distinct from 2
     or v_order.billing_mode<>'open_bill' or v_order.billing_status<>'open'
     or v_order.payment_status<>'pending' or v_order.paid_at is not null then
    raise exception 'Cannot cancel an item on this bill' using errcode='22023';
  end if;
  select * into v_item from public.order_items where id=p_order_item_id for update;
  if v_item.fulfillment_status<>'received' then
    raise exception 'Only unprepared items can be cancelled' using errcode='22023';
  end if;
  if (select count(*) from public.order_items where order_id=v_order.id
      and fulfillment_status<>'cancelled')<=1 then
    raise exception 'Last line cannot be removed; void the bill separately' using errcode='22023';
  end if;
  update public.order_items set fulfillment_status='cancelled',cancelled_at=now() where id=p_order_item_id;
  select coalesce(sum(quantity*unit_price),0) into v_amount from public.order_items
    where order_id=v_order.id and fulfillment_status<>'cancelled';
  update public.orders set total_amount=v_amount where id=v_order.id;
  insert into public.beanbook_order_activity(brand_id,order_id,order_item_id,actor_user_id,operation,metadata)
    values(p_brand_id,v_order.id,p_order_item_id,p_actor,'item_cancelled',
      jsonb_build_object('reason',btrim(p_reason),'total',v_amount));
  return v_amount;
end;
$$;
revoke all on function public.beanbook_cancel_open_bill_item(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.beanbook_cancel_open_bill_item(uuid,uuid,uuid,text) to service_role;

create function public.beanbook_begin_bill_settlement(
  p_brand_id uuid,p_order_id uuid,p_actor uuid
) returns numeric language plpgsql security invoker set search_path='' as $$
declare v_order public.orders%rowtype; v_amount numeric;
begin
  perform public.beanbook_assert_order_staff(p_brand_id,p_actor);
  select * into v_order from public.orders where id=p_order_id and brand_id=p_brand_id for update;
  if not found or v_order.workflow_version is distinct from 2
     or v_order.billing_mode<>'open_bill' or v_order.order_channel<>'counter'
     or v_order.payment_status<>'pending' or v_order.paid_at is not null
     or v_order.razorpay_order_id is not null
     or v_order.billing_status not in ('open','settlement_in_progress') then
    raise exception 'Bill cannot be settled' using errcode='22023';
  end if;
  select coalesce(sum(quantity*unit_price),0) into v_amount from public.order_items
    where order_id=p_order_id and fulfillment_status<>'cancelled';
  if v_amount<=0 or v_amount<>v_order.total_amount then
    raise exception 'Bill integrity check failed' using errcode='22023';
  end if;
  if v_order.billing_status='open' then
    update public.orders set billing_status='settlement_in_progress' where id=p_order_id;
    insert into public.beanbook_order_activity(brand_id,order_id,actor_user_id,operation,metadata)
      values(p_brand_id,p_order_id,p_actor,'settlement_started',jsonb_build_object('total',v_amount));
  end if;
  return v_amount;
end;
$$;
revoke all on function public.beanbook_begin_bill_settlement(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.beanbook_begin_bill_settlement(uuid,uuid,uuid) to service_role;

-- Keep the existing manual payment RPC name so no legacy endpoint can bypass
-- the open-bill settlement lock. For legacy rows preserve current behavior.
create or replace function public.beanbook_confirm_counter_payment(
 p_brand_id uuid, p_order_number text, p_staff_user uuid, p_payment_method text,
 p_reference text
) returns text language plpgsql security invoker set search_path='' as $$
declare v_order public.orders%rowtype; v_sum numeric;
begin
  perform public.beanbook_assert_order_staff(p_brand_id,p_staff_user);
  if p_payment_method not in ('upi','cash') then
    raise exception 'Invalid payment method' using errcode='22023';
  end if;
  if p_payment_method='upi' and (p_reference is null or p_reference !~ '^[A-Za-z0-9-]{8,35}$') then
    raise exception 'Verified UPI transaction reference required' using errcode='22023';
  end if;
  if length(coalesce(p_reference,''))>60 then
    raise exception 'Reference too long' using errcode='22023';
  end if;
  select * into v_order from public.orders
    where brand_id=p_brand_id and order_number=p_order_number and order_channel='counter' for update;
  if not found then raise exception 'Counter order not found' using errcode='22023'; end if;
  if v_order.payment_status<>'pending' or v_order.paid_at is not null then
    raise exception 'This order is no longer awaiting payment' using errcode='22023';
  end if;
  if v_order.workflow_version=2 then
    if (v_order.billing_mode='open_bill' and v_order.billing_status<>'settlement_in_progress')
       or (v_order.billing_mode='pay_first' and v_order.billing_status<>'open') then
      raise exception 'Bill must enter settlement first' using errcode='22023';
    end if;
    select coalesce(sum(quantity*unit_price),0) into v_sum from public.order_items
      where order_id=v_order.id and fulfillment_status<>'cancelled';
    if v_sum<=0 or v_sum<>v_order.total_amount then
      raise exception 'Bill total differs from active priced items' using errcode='22023';
    end if;
  end if;
  insert into public.counter_payment_confirmations(order_id,brand_id,confirmed_by,payment_method,transaction_reference)
    values(v_order.id,p_brand_id,p_staff_user,p_payment_method,nullif(btrim(coalesce(p_reference,'')),''));
  update public.orders set payment_status='paid',paid_at=now(),
    billing_status=case when workflow_version=2 then 'settled' else billing_status end
    where id=v_order.id;
  if v_order.workflow_version=2 then
    insert into public.beanbook_order_activity(brand_id,order_id,actor_user_id,operation,metadata)
      values(p_brand_id,v_order.id,p_staff_user,'settled',
        jsonb_build_object('method',p_payment_method,'amount',v_order.total_amount));
  end if;
  return 'paid';
end;
$$;
revoke all on function public.beanbook_confirm_counter_payment(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.beanbook_confirm_counter_payment(uuid,text,uuid,text,text) to service_role;
