-- Save product details, all sizes and eligible add-ons as ONE transaction.
-- This prevents a product appearing partially configured after an API failure.
-- Function is SECURITY INVOKER; only the authenticated backend service role
-- may call it, after business owner membership verification in the API.
create or replace function public.beanbook_save_product_catalog(
  p_brand_id uuid,
  p_product_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_sizes jsonb,
  p_addon_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_name text;
  v_price numeric;
  v_position integer := 0;
  v_seen text[] := '{}';
  v_addon_id uuid;
  v_option_name text;
  v_size_names text[] := '{}';
begin
  if length(trim(coalesce(p_name,''))) not between 2 and 120
    or length(coalesce(p_description,'')) > 500
    or p_price is null or p_price <= 0 or p_price > 100000
    or p_price <> round(p_price,2)
  then raise exception 'Invalid product name, description or price' using errcode='22023'; end if;

  if p_sizes is null or jsonb_typeof(p_sizes) <> 'array'
    or jsonb_array_length(p_sizes) > 12
    or coalesce(cardinality(p_addon_ids),0) > 50
  then raise exception 'Invalid size or add-on selection' using errcode='22023'; end if;

  for v_item in select value from jsonb_array_elements(p_sizes)
  loop
    v_name := trim(coalesce(v_item->>'name',''));
    if length(v_name) not between 1 and 60
       or lower(v_name) = any(v_seen)
       or coalesce(v_item->>'price','') !~ '^[0-9]+([.][0-9]{1,2})?$'
    then raise exception 'Invalid or duplicate size' using errcode='22023'; end if;
    v_price := (v_item->>'price')::numeric;
    if v_price <= 0 or v_price > 100000
    then raise exception 'Invalid size price' using errcode='22023'; end if;
    v_seen := array_append(v_seen,lower(v_name));
    v_size_names := array_append(v_size_names,v_name);
  end loop;

  if coalesce(cardinality(p_addon_ids),0) <>
     (select count(distinct x) from unnest(coalesce(p_addon_ids,ARRAY[]::uuid[])) x)
  then raise exception 'Duplicate add-ons' using errcode='22023'; end if;

  for v_addon_id in select x from unnest(coalesce(p_addon_ids,ARRAY[]::uuid[])) x
  loop
    if not exists(select 1 from public.product_addons
       where id=v_addon_id and brand_id=p_brand_id and is_active=true)
    then raise exception 'Add-on unavailable for this business' using errcode='22023'; end if;

    -- A fixed-price product uses Standard for optional extras; sized products
    -- must have a matching price for every configured size.
    for v_option_name in select unnest(case when cardinality(v_size_names)=0
                                then array['Standard']::text[] else v_size_names end)
    loop
      if not exists(select 1 from public.product_addon_prices
          where addon_id=v_addon_id and brand_id=p_brand_id
            and lower(size_name)=lower(v_option_name))
      then raise exception 'Add-on missing price for size %', v_option_name using errcode='22023'; end if;
    end loop;
  end loop;

  if p_product_id is null then
    insert into public.products(brand_id,name,description,price,is_active)
    values(p_brand_id,trim(p_name),nullif(trim(p_description),''),p_price,true)
    returning id into v_id;
  else
    update public.products
       set name=trim(p_name),description=nullif(trim(p_description),''),price=p_price
     where id=p_product_id and brand_id=p_brand_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Product not found for this business' using errcode='P0002';
    end if;
  end if;

  delete from public.product_sizes where brand_id=p_brand_id and product_id=v_id;
  for v_item in select value from jsonb_array_elements(p_sizes)
  loop
    insert into public.product_sizes(brand_id,product_id,name,price,display_order)
    values(p_brand_id,v_id,trim(v_item->>'name'),(v_item->>'price')::numeric,v_position);
    v_position := v_position + 1;
  end loop;

  delete from public.product_allowed_addons where brand_id=p_brand_id and product_id=v_id;
  insert into public.product_allowed_addons(brand_id,product_id,addon_id)
  select p_brand_id,v_id,x from unnest(coalesce(p_addon_ids,ARRAY[]::uuid[])) x;
  return v_id;
end;
$$;
revoke all on function public.beanbook_save_product_catalog(uuid,uuid,text,text,numeric,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.beanbook_save_product_catalog(uuid,uuid,text,text,numeric,jsonb,uuid[]) to service_role;
