-- Atomically replace a Received line with a newly priced line, preserving
-- the original as a cancelled audit record. The preparation round is unchanged.
-- All pricing is resolved by beanbook_insert_priced_bill_items on the server.
create function public.beanbook_edit_unprepared_bill_item(
 p_brand_id uuid,
 p_order_item_id uuid,
 p_actor uuid,
 p_request_id uuid,
 p_size_name text,
 p_addon_ids jsonb
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 v_order public.orders%rowtype;
 v_old public.order_items%rowtype;
 v_key public.beanbook_order_request_keys%rowtype;
 v_payload jsonb;
 v_hash text;
 v_amount numeric;
 v_new_id uuid;
 v_response jsonb;
begin
 perform public.beanbook_assert_order_staff(p_brand_id,p_actor);
 if p_request_id is null
    or p_addon_ids is null or jsonb_typeof(p_addon_ids)<>'array'
    or jsonb_array_length(p_addon_ids)>12
    or length(coalesce(p_size_name,''))>60 then
   raise exception 'Invalid edit request' using errcode='22023';
 end if;

 -- Lock the parent first, matching the lock order of item fulfillment and settlement.
 select o.* into v_order from public.orders o
 join public.order_items oi on oi.order_id=o.id
 where o.brand_id=p_brand_id and oi.id=p_order_item_id for update of o;
 if not found then raise exception 'Order item not found' using errcode='22023'; end if;

 v_payload:=jsonb_build_object('item',p_order_item_id,'size',p_size_name,'addons',p_addon_ids);
 v_hash:=md5(v_payload::text);
 insert into public.beanbook_order_request_keys(brand_id,operation,request_id,order_id,payload_hash)
 values(p_brand_id,'edit_item',p_request_id,v_order.id,v_hash)
 on conflict do nothing;
 select * into v_key from public.beanbook_order_request_keys
 where brand_id=p_brand_id and operation='edit_item' and request_id=p_request_id
 for update;
 if v_key.payload_hash<>v_hash or v_key.order_id is distinct from v_order.id then
   raise exception 'Request key already used for another edit' using errcode='22023';
 end if;
 if v_key.response is not null then return v_key.response; end if;

 if v_order.workflow_version is distinct from 2
    or v_order.order_channel<>'counter'
    or v_order.billing_mode<>'open_bill'
    or v_order.billing_status<>'open'
    or v_order.payment_status<>'pending'
    or v_order.paid_at is not null
    or v_order.razorpay_order_id is not null then
   raise exception 'This bill cannot be edited' using errcode='22023';
 end if;
 select * into v_old from public.order_items where id=p_order_item_id and order_id=v_order.id for update;
 if not found or v_old.fulfillment_status<>'received' or v_old.prep_started_at is not null
    or v_old.cancelled_at is not null then
   raise exception 'Only items not yet preparing may be edited' using errcode='22023';
 end if;

 -- Reuse the SAME preparation round; edit is not a new customer order.
 perform public.beanbook_insert_priced_bill_items(
   p_brand_id, v_order.event_id, v_order.id,
   jsonb_build_array(jsonb_build_object(
     'product_id',v_old.product_id,'quantity',v_old.quantity,
     'size_name',p_size_name,'addon_ids',p_addon_ids)),
   v_old.round_number
 );
 select id into v_new_id from public.order_items
 where order_id=v_order.id and round_number=v_old.round_number
   and id<>v_old.id and fulfillment_status='received'
 order by created_at desc,id desc limit 1;
 -- The most recent row is expected to be the insert above. Use a transaction-local
 -- timestamp guard for clarity; no other writer can append during the parent lock.
 if v_new_id is null then raise exception 'Replacement line missing' using errcode='22023'; end if;

 update public.order_items set fulfillment_status='cancelled',cancelled_at=statement_timestamp()
 where id=v_old.id;
 select coalesce(sum(quantity*unit_price),0) into v_amount
 from public.order_items where order_id=v_order.id and fulfillment_status<>'cancelled';
 if v_amount<=0 then raise exception 'Invalid replacement bill total' using errcode='22023'; end if;
 update public.orders set total_amount=v_amount where id=v_order.id;
 v_response:=jsonb_build_object('orderId',v_order.id,'oldItemId',v_old.id,
   'newItemId',v_new_id,'amount',v_amount,'round',v_old.round_number);
 update public.beanbook_order_request_keys set response=v_response
 where brand_id=p_brand_id and operation='edit_item' and request_id=p_request_id;
 insert into public.beanbook_order_activity(brand_id,order_id,order_item_id,actor_user_id,operation,metadata)
 values(p_brand_id,v_order.id,v_old.id,p_actor,'item_edited',
   jsonb_build_object('replacement_item_id',v_new_id,'old_unit_price',v_old.unit_price,
    'new_bill_total',v_amount,'new_size',p_size_name,'new_addon_ids',p_addon_ids));
 return v_response;
end;
$$;
revoke all on function public.beanbook_edit_unprepared_bill_item(uuid,uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.beanbook_edit_unprepared_bill_item(uuid,uuid,uuid,uuid,text,jsonb)
  to service_role;
