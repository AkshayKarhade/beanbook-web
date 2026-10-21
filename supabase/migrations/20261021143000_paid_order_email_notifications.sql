-- Record each paid-order alert and claim it atomically across checkout + webhooks.
-- Notifications are operational data, never customer-visible via the Data API.
create table if not exists public.order_email_notifications (
  order_id uuid primary key references public.orders(id) on delete cascade,
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_email_id text,
  email_subject text,
  email_body text,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.order_email_notifications enable row level security;
revoke all on public.order_email_notifications from anon, authenticated;
grant select, insert, update on public.order_email_notifications to service_role;

-- The unique order_id plus conditional conflict update is a concurrency-safe claim.
-- A failed or timed-out attempt can be retried, but 'sent' cannot be claimed again.
create or replace function public.claim_paid_order_email_notification(p_order_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  if not exists (
    select 1 from public.orders
    where id = p_order_id
      and payment_status in ('paid', 'paid_stock_issue')
      and razorpay_payment_id is not null
  ) then
    return false;
  end if;

  insert into public.order_email_notifications
    (order_id, status, attempt_count, last_attempt_at)
  values (p_order_id, 'sending', 1, now())
  on conflict (order_id) do update
    set status = 'sending',
        attempt_count = public.order_email_notifications.attempt_count + 1,
        last_attempt_at = now(),
        last_error = null
  where public.order_email_notifications.status = 'failed'
     or (
       public.order_email_notifications.status = 'sending'
       and public.order_email_notifications.last_attempt_at < now() - interval '10 minutes'
     )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;
revoke all on function public.claim_paid_order_email_notification(uuid) from public, anon, authenticated;
grant execute on function public.claim_paid_order_email_notification(uuid) to service_role;

-- Aggregate all paid orders in SQL (no REST pagination limits).
create or replace function public.get_paid_event_preparation_summary(p_event_id uuid)
returns jsonb
language sql stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'paid_orders', (
      select count(*) from public.orders o
      where o.event_id = p_event_id
        and o.payment_status in ('paid', 'paid_stock_issue')
    ),
    'total_bottles', (
      select coalesce(sum(oi.quantity), 0)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.event_id = p_event_id
        and o.payment_status in ('paid', 'paid_stock_issue')
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object('name', totals.product_name, 'quantity', totals.quantity)
        order by totals.product_name
      )
      from (
        select p.name as product_name, sum(oi.quantity)::integer as quantity
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
        where o.event_id = p_event_id
          and o.payment_status in ('paid', 'paid_stock_issue')
        group by p.name
      ) totals
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.get_paid_event_preparation_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_paid_event_preparation_summary(uuid) to service_role;
