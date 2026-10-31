-- MVP-1 configurable drink sizes and reusable size-priced add-ons.
-- No existing product, order or payment rows are altered.
create table if not exists public.product_sizes (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null references public.brands(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 60),
 price numeric(12,2) not null check (price > 0 and price <= 100000),
 display_order integer not null default 0,
 created_at timestamptz not null default now(),
 unique(product_id,name),
 unique(id,brand_id)
);
create table if not exists public.product_addons (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null references public.brands(id) on delete cascade,
 name text not null check (length(trim(name)) between 2 and 120),
 description text,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(brand_id,name),
 unique(id,brand_id)
);
create table if not exists public.product_addon_prices (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null references public.brands(id) on delete cascade,
 addon_id uuid not null,
 size_name text not null check(length(trim(size_name)) between 1 and 60),
 price numeric(12,2) not null check(price >= 0 and price <= 100000),
 foreign key (addon_id,brand_id) references public.product_addons(id,brand_id) on delete cascade,
 unique(addon_id,size_name)
);
create table if not exists public.product_allowed_addons (
 brand_id uuid not null references public.brands(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 addon_id uuid not null,
 foreign key (addon_id,brand_id) references public.product_addons(id,brand_id) on delete cascade,
 primary key(product_id,addon_id)
);
create index if not exists product_sizes_brand_idx on public.product_sizes(brand_id,product_id);
create index if not exists product_allowed_addons_brand_idx on public.product_allowed_addons(brand_id,product_id);
alter table public.product_sizes enable row level security;
alter table public.product_addons enable row level security;
alter table public.product_addon_prices enable row level security;
alter table public.product_allowed_addons enable row level security;
revoke all on public.product_sizes,public.product_addons,public.product_addon_prices,public.product_allowed_addons from anon,authenticated;
grant select,insert,update,delete on public.product_sizes,public.product_addons,public.product_addon_prices,public.product_allowed_addons to service_role;
