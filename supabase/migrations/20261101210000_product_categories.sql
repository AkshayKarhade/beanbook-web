-- Product categories are free-form labels scoped to each product's existing tenant.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_category_length_check;
ALTER TABLE public.products ADD CONSTRAINT products_category_length_check CHECK (category IS NULL OR char_length(category) <= 60);
