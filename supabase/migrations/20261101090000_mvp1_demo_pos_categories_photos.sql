-- Optional cafe product categorization and external demo imagery for POS trials.
-- Demo images are restricted to public Unsplash CDN URLs; product uploads in Storage remain preferred.
alter table public.products
  add column if not exists category text,
  add column if not exists demo_photo_url text;
alter table public.products
  add constraint products_demo_photo_url_check
  check (demo_photo_url is null or demo_photo_url ~ '^https://images[.]unsplash[.]com/photo-[A-Za-z0-9-]+([?][A-Za-z0-9=&._%-]+)?$');
