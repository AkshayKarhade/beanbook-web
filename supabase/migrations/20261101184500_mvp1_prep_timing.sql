-- Capture server-authoritative item preparation timing; existing orders are untouched.
alter table public.order_items
  add column if not exists prep_started_at timestamptz,
  add column if not exists prep_ready_at timestamptz;

create or replace function public.beanbook_stamp_item_prep_times()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.fulfillment_status = 'preparing' and old.fulfillment_status = 'received' then
    new.prep_started_at := coalesce(old.prep_started_at, statement_timestamp());
  elsif new.fulfillment_status = 'ready' and old.fulfillment_status = 'preparing' then
    new.prep_ready_at := coalesce(old.prep_ready_at, statement_timestamp());
  end if;
  return new;
end;
$$;

drop trigger if exists beanbook_stamp_item_prep_times on public.order_items;
create trigger beanbook_stamp_item_prep_times
before update of fulfillment_status on public.order_items
for each row
when (old.fulfillment_status is distinct from new.fulfillment_status)
execute function public.beanbook_stamp_item_prep_times();
