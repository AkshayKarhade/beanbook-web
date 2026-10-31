-- Product photos are public-facing menu assets, but only server-side
-- business-owner requests may change their storage and metadata.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,2097152,array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update
set public=excluded.public,file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.product_images (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null references public.brands(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 slot smallint not null check (slot between 1 and 3),
 storage_path text not null unique,
 content_type text not null check(content_type in ('image/jpeg','image/png','image/webp')),
 created_at timestamptz not null default now(),
 unique(product_id,slot)
);
create index if not exists product_images_brand_product_idx
on public.product_images(brand_id,product_id);
alter table public.product_images enable row level security;
revoke all on public.product_images from anon,authenticated;
grant select,insert,update,delete on public.product_images to service_role;

-- Prevent a future API regression from linking an image to another tenant.
create or replace function public.beanbook_validate_image_owner()
returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.products p
               where p.id=new.product_id and p.brand_id=new.brand_id) then
   raise exception 'Product image must belong to the same business';
 end if;
 return new;
end;
$$;
drop trigger if exists beanbook_product_image_owner on public.product_images;
create trigger beanbook_product_image_owner
before insert or update on public.product_images
for each row execute function public.beanbook_validate_image_owner();
revoke all on function public.beanbook_validate_image_owner() from public,anon,authenticated;
