-- Order Active Time ends when the bill is paid AND every live item is served.
-- Record this milestone once; later dashboard refreshes must not extend it.
alter table public.orders add column if not exists closed_at timestamptz;

create or replace function public.beanbook_close_fulfilled_order(p_order_id uuid)
returns void language plpgsql set search_path='' as $$
begin
  update public.orders o
     set closed_at=statement_timestamp()
   where o.id=p_order_id
     and o.workflow_version=2
     and o.closed_at is null
     and o.payment_status='paid'
     and o.paid_at is not null
     and exists (
       select 1 from public.order_items i
       where i.order_id=o.id and i.fulfillment_status<>'cancelled'
     )
     and not exists (
       select 1 from public.order_items i
       where i.order_id=o.id and i.fulfillment_status not in ('completed','cancelled')
     );
end;
$$;
revoke all on function public.beanbook_close_fulfilled_order(uuid) from public,anon,authenticated;
grant execute on function public.beanbook_close_fulfilled_order(uuid) to service_role;

create or replace function public.beanbook_close_on_item_served()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.fulfillment_status='completed' and old.fulfillment_status is distinct from 'completed' then
    perform public.beanbook_close_fulfilled_order(new.order_id);
  end if;
  return new;
end;
$$;
drop trigger if exists beanbook_close_on_item_served on public.order_items;
create trigger beanbook_close_on_item_served
after update of fulfillment_status on public.order_items
for each row execute function public.beanbook_close_on_item_served();

create or replace function public.beanbook_close_on_payment()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.payment_status='paid' and old.payment_status is distinct from 'paid' then
    perform public.beanbook_close_fulfilled_order(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists beanbook_close_on_payment on public.orders;
create trigger beanbook_close_on_payment
after update of payment_status on public.orders
for each row execute function public.beanbook_close_on_payment();

-- The original serving timestamps are already in the activity audit.
-- Backfill only completed, paid v2 orders with a recorded serving event.
update public.orders o
set closed_at=greatest(
  o.paid_at,
  (select max(a.created_at)
   from public.beanbook_order_activity a
   where a.order_id=o.id
     and a.operation='fulfillment_advanced'
     and a.metadata->>'to'='completed')
)
where o.workflow_version=2
  and o.closed_at is null
  and o.payment_status='paid'
  and o.paid_at is not null
  and exists (
    select 1 from public.beanbook_order_activity a
    where a.order_id=o.id and a.operation='fulfillment_advanced' and a.metadata->>'to'='completed'
  )
  and exists (
    select 1 from public.order_items i
    where i.order_id=o.id and i.fulfillment_status<>'cancelled'
  )
  and not exists (
    select 1 from public.order_items i
    where i.order_id=o.id and i.fulfillment_status not in ('completed','cancelled')
  );
