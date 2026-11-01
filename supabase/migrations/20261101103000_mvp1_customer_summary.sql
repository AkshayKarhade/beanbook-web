-- Read-only per-business customer summary for the MVP customer directory.
-- LTV is captured revenue from paid orders only; order count includes all statuses.
-- The invoking backend verifies owner membership before calling with the derived brand ID.
create or replace function public.beanbook_customer_summary(p_brand_id uuid)
returns table (
  customer_id uuid,
  customer_name text,
  phone text,
  lifetime_value numeric,
  order_count bigint,
  latest_order_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id as customer_id,
    c.name as customer_name,
    c.phone,
    coalesce(sum(o.total_amount) filter (where o.payment_status = 'paid'), 0)::numeric as lifetime_value,
    count(o.id)::bigint as order_count,
    max(o.created_at) as latest_order_at
  from public.customers as c
  left join public.orders as o
    on o.customer_id = c.id
    and o.brand_id = c.brand_id
  where c.brand_id = p_brand_id
  group by c.id, c.name, c.phone
  order by max(o.created_at) desc nulls last, c.name asc, c.id asc;
$$;

revoke all on function public.beanbook_customer_summary(uuid) from public, anon, authenticated;
grant execute on function public.beanbook_customer_summary(uuid) to service_role;
