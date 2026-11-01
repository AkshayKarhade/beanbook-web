-- MVP-1: allow concurrent regular menus for multiple business locations.
-- Legacy sales/events and their order links are not changed.
drop index if exists public.events_one_regular_menu_per_business;

-- Publish only a valid owned draft that contains an active product.
-- Called solely by the authorized backend service role.
create or replace function public.beanbook_publish_sales_menu(
 p_brand_id uuid,
 p_menu_id uuid
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
 v_menu public.events%rowtype;
begin
 select * into v_menu
 from public.events
 where id=p_menu_id and brand_id=p_brand_id
  and sales_mode in ('regular','event')
 for update;
 if not found or v_menu.status <> 'draft' then
  raise exception 'Only owned draft menus can be published' using errcode='22023';
 end if;
 if not exists (
  select 1 from public.event_products ep
  join public.products p on p.id=ep.product_id
  where ep.event_id=p_menu_id and p.brand_id=p_brand_id
    and ep.is_available and p.is_active
 ) then
  raise exception 'Choose at least one active product before publishing' using errcode='22023';
 end if;
 if v_menu.sales_mode='event' and
    (v_menu.event_start_date is null or v_menu.event_end_date is null) then
  raise exception 'Event menu dates are required' using errcode='22023';
 end if;
 update public.events set status='published' where id=p_menu_id and brand_id=p_brand_id;
 return p_menu_id;
end;
$$;
revoke all on function public.beanbook_publish_sales_menu(uuid,uuid) from public,anon,authenticated;
grant execute on function public.beanbook_publish_sales_menu(uuid,uuid) to service_role;
