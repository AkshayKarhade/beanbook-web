-- Each new counter bill has a staff-selected payment workflow.
-- Business Settings remain the per-business default; historical bills are unchanged.
-- The v3 RPC remains available for old previews; only v4 accepts an override.
create or replace function public.beanbook_create_counter_order_v4(
  p_brand_id uuid,p_menu_id uuid,p_name text,p_phone text,p_items jsonb,
  p_actor uuid,p_request_id uuid,p_billing_mode text
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
  if p_billing_mode not in ('pay_first','open_bill') or p_billing_mode is null then
    raise exception 'Choose Pay First or Pay Later' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('menu',p_menu_id,'name',p_name,'phone',p_phone,'items',p_items,'billing_mode',p_billing_mode)::text);
  insert into public.beanbook_order_request_keys(brand_id,operation,request_id,payload_hash)
  values(p_brand_id,'create_counter',p_request_id,v_hash) on conflict do nothing;
  select * into v_key from public.beanbook_order_request_keys
    where brand_id=p_brand_id and operation='create_counter' and request_id=p_request_id for update;
  if v_key.payload_hash<>v_hash then raise exception 'Idempotency key reused with a different cart' using errcode='22023'; end if;
  if v_key.response is not null then return v_key.response; end if;
  v_mode:=p_billing_mode;
  v_receipt:=public.beanbook_create_counter_order_v2(p_brand_id,p_menu_id,p_name,p_phone,p_items);
  v_order_id:=(v_receipt->>'orderId')::uuid;
  update public.order_items set fulfillment_status='received',round_number=1 where order_id=v_order_id;
  update public.orders set workflow_version=2,billing_mode=v_mode,billing_status='open',order_status='received'
    where id=v_order_id and brand_id=p_brand_id;
  v_receipt:=v_receipt||jsonb_build_object('billingMode',v_mode,'billingStatus','open');
  update public.beanbook_order_request_keys set order_id=v_order_id,response=v_receipt
    where brand_id=p_brand_id and operation='create_counter' and request_id=p_request_id;
  insert into public.beanbook_order_activity(brand_id,order_id,actor_user_id,operation,metadata)
    values(p_brand_id,v_order_id,p_actor,'created',jsonb_build_object('billing_mode',v_mode,'total',v_receipt->'amount'));
  return v_receipt;
end;
$$;

revoke all on function public.beanbook_create_counter_order_v4(uuid,uuid,text,text,jsonb,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.beanbook_create_counter_order_v4(uuid,uuid,text,text,jsonb,uuid,uuid,text) to service_role;
