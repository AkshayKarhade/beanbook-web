-- Additive costing foundation. Apply to an isolated test database before release.
-- All tables are backend-only. Existing checkout and stock routines are untouched.
begin;

create unique index if not exists beanbook_products_id_brand_uidx on public.products(id, brand_id);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  base_unit text not null check (base_unit in ('g','ml','piece')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, brand_id)
);
create unique index ingredients_brand_name_uidx on public.ingredients(brand_id, lower(btrim(name)));

create table public.ingredient_purchases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  ingredient_id uuid not null,
  purchased_on date not null,
  quantity numeric(18,6) not null check (quantity > 0 and quantity <= 100000000),
  total_cost numeric(14,2) not null check (total_cost >= 0 and total_cost <= 100000000),
  supplier text check (length(supplier) <= 120),
  created_at timestamptz not null default now(),
  foreign key (ingredient_id,brand_id) references public.ingredients(id,brand_id)
);
create index ingredient_purchases_latest_idx on public.ingredient_purchases(brand_id,ingredient_id,purchased_on desc,created_at desc,id desc);

-- Append-only recipe versions. Blank size means a product without size variants.
-- A recipe can produce multiple saleable servings (batch preparation).
-- Add-on recipes are separate incremental costs, not duplicated inside base recipes.
create table public.costing_recipes (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  product_id uuid,
  addon_id uuid,
  size_name text not null default '' check (length(size_name) <= 120),
  yield_quantity numeric(14,4) not null check (yield_quantity > 0 and yield_quantity <= 1000000),
  effective_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default now(),
  unique (id,brand_id),
  check ((product_id is not null) <> (addon_id is not null)),
  foreign key (product_id,brand_id) references public.products(id,brand_id),
  foreign key (addon_id,brand_id) references public.product_addons(id,brand_id)
);
create index costing_recipes_product_idx on public.costing_recipes(brand_id,product_id,size_name,effective_at desc,id desc) where product_id is not null;
create index costing_recipes_addon_idx on public.costing_recipes(brand_id,addon_id,size_name,effective_at desc,id desc) where addon_id is not null;

create table public.costing_recipe_items (
  brand_id uuid not null references public.brands(id),
  recipe_id uuid not null,
  ingredient_id uuid not null,
  quantity numeric(18,6) not null check (quantity > 0 and quantity <= 100000000),
  primary key (recipe_id,ingredient_id),
  foreign key (recipe_id,brand_id) references public.costing_recipes(id,brand_id),
  foreign key (ingredient_id,brand_id) references public.ingredients(id,brand_id)
);

-- Ordinary cash/operating expense entries; ingredient purchase amounts stay in
-- their own ledger to avoid double-counting ingredients as operating expenses.
create table public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  incurred_on date not null,
  category text not null check (category in ('rent','utilities','labour','commission','payment_fee','marketing','transport','other')),
  amount numeric(14,2) not null check (amount > 0 and amount <= 100000000),
  description text not null check (length(btrim(description)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index business_expenses_period_idx on public.business_expenses(brand_id,incurred_on);

-- Audit-only observations; do not silently adjust effective stock.
-- Expected quantity is captured by the server at the instant a count is recorded.
create table public.inventory_stock_counts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  inventory_unit_id uuid not null references public.inventory_units(id),
  product_id uuid not null,
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer not null check (counted_quantity >= 0),
  reason text check (reason in ('unknown','wastage','personal_consumption','unpaid_removal','external_sale','count_correction','other')),
  notes text check (length(notes) <= 500),
  counted_at timestamptz not null default now(),
  foreign key (product_id,brand_id) references public.products(id,brand_id)
);
create unique index if not exists beanbook_inventory_units_id_brand_uidx on public.inventory_units(id,brand_id);
alter table public.inventory_stock_counts add constraint inventory_stock_counts_unit_brand_fk foreign key (inventory_unit_id,brand_id) references public.inventory_units(id,brand_id);
create index inventory_stock_counts_lookup_idx on public.inventory_stock_counts(brand_id,inventory_unit_id,product_id,counted_at desc);

alter table public.ingredients enable row level security;
alter table public.ingredient_purchases enable row level security;
alter table public.costing_recipes enable row level security;
alter table public.costing_recipe_items enable row level security;
alter table public.business_expenses enable row level security;
alter table public.inventory_stock_counts enable row level security;
revoke all on public.ingredients,public.ingredient_purchases,public.costing_recipes,public.costing_recipe_items,public.business_expenses,public.inventory_stock_counts from public,anon,authenticated;
grant select,insert on public.ingredients,public.ingredient_purchases,public.costing_recipes,public.costing_recipe_items,public.business_expenses,public.inventory_stock_counts to service_role;
grant update(is_active) on public.ingredients to service_role;

-- Atomic append of a recipe and all its lines. No public or authenticated RPC access.
create function public.beanbook_save_costing_recipe(p_brand_id uuid,p_product_id uuid,p_addon_id uuid,p_size_name text,p_yield numeric,p_items jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare rid uuid; item jsonb; n integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Recipe ingredients required' using errcode='22023'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 100 then raise exception 'Use 1 to 100 recipe ingredients' using errcode='22023'; end if;
  if (p_product_id is null) = (p_addon_id is null) or p_size_name is null or p_yield is null or p_yield <= 0 then raise exception 'Invalid recipe target or yield' using errcode='22023'; end if;
  if p_product_id is not null then
    if not exists(select 1 from public.products where id=p_product_id and brand_id=p_brand_id) then raise exception 'Unknown product' using errcode='22023'; end if;
    if (p_size_name='' and exists(select 1 from public.product_sizes where product_id=p_product_id and brand_id=p_brand_id)) or
       (p_size_name<>'' and not exists(select 1 from public.product_sizes where product_id=p_product_id and brand_id=p_brand_id and name=p_size_name)) then raise exception 'Select an existing product size' using errcode='22023'; end if;
  else
    if not exists(select 1 from public.product_addons where id=p_addon_id and brand_id=p_brand_id) then raise exception 'Unknown add-on' using errcode='22023'; end if;
    if not exists(select 1 from public.product_addon_prices where addon_id=p_addon_id and brand_id=p_brand_id and coalesce(size_name,'')=p_size_name) then raise exception 'Select an existing add-on size' using errcode='22023'; end if;
  end if;
  insert into public.costing_recipes(brand_id,product_id,addon_id,size_name,yield_quantity) values(p_brand_id,p_product_id,p_addon_id,p_size_name,p_yield) returning id into rid;
  for item in select value from jsonb_array_elements(p_items) loop
    if not exists(select 1 from public.ingredients where brand_id=p_brand_id and id=(item->>'ingredient_id')::uuid and is_active) then raise exception 'Unknown or inactive ingredient' using errcode='22023'; end if;
    insert into public.costing_recipe_items(brand_id,recipe_id,ingredient_id,quantity)
      values(p_brand_id,rid,(item->>'ingredient_id')::uuid,(item->>'quantity')::numeric);
  end loop;
  return rid;
end $$;
revoke all on function public.beanbook_save_costing_recipe(uuid,uuid,uuid,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.beanbook_save_costing_recipe(uuid,uuid,uuid,text,numeric,jsonb) to service_role;

-- Latest documented purchase price, not weighted-average/FIFO COGS.
-- A missing ingredient cost produces NULL, never a misleading zero.
create function public.beanbook_current_recipe_costs(p_brand_id uuid,p_as_of date)
returns table(recipe_id uuid,product_id uuid,addon_id uuid,size_name text,yield_quantity numeric,ingredient_count bigint,missing_cost_count bigint,estimated_unit_cost numeric)
language sql stable security invoker set search_path='' as $$
  with latest_recipe as (
    select distinct on (r.product_id,r.addon_id,r.size_name) r.*
    from public.costing_recipes r
    where r.brand_id=p_brand_id and r.effective_at < ((p_as_of+1)::timestamp at time zone 'Asia/Kolkata')
    order by r.product_id,r.addon_id,r.size_name,r.effective_at desc,r.id desc
  ), costs as (
    select distinct on (p.ingredient_id) p.ingredient_id,p.total_cost/p.quantity as price
    from public.ingredient_purchases p
    where p.brand_id=p_brand_id and p.purchased_on<=p_as_of
    order by p.ingredient_id,p.purchased_on desc,p.created_at desc,p.id desc
  )
  select r.id,r.product_id,r.addon_id,r.size_name,r.yield_quantity,count(i.ingredient_id),
    count(i.ingredient_id) filter(where c.price is null),
    case when count(i.ingredient_id)>0 and count(i.ingredient_id) filter(where c.price is null)=0
      then round(sum(i.quantity*c.price)/r.yield_quantity,4) else null end
  from latest_recipe r
  left join public.costing_recipe_items i on i.brand_id=r.brand_id and i.recipe_id=r.id
  left join costs c on c.ingredient_id=i.ingredient_id
  group by r.id,r.product_id,r.addon_id,r.size_name,r.yield_quantity;
$$;
revoke all on function public.beanbook_current_recipe_costs(uuid,date) from public,anon,authenticated;
grant execute on function public.beanbook_current_recipe_costs(uuid,date) to service_role;
commit;
