-- Applied to the BeanBook Supabase project as migration 20261009201836.
-- CRAG Express Checkout does not collect customer details.
-- Other sales flows continue validating customer data in their API handlers.
-- This changes nullability only; it does not delete customer records.
alter table public.orders
  alter column customer_id drop not null;
