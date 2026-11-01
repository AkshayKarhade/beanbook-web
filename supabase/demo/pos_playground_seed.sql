-- MANUAL SEED ONLY: execute AFTER 20261101090000 schema migration is applied.
-- The demo menu is published for POS testing and can create real pending orders;
-- use fake customer details and do NOT send actual payments.
DO $seed$
DECLARE
  v_brand uuid := 'a5e187ff-5fd0-41ff-8a5b-b413a2ed76ca';
  v_menu uuid;
  v_product uuid;
  v_id uuid;
BEGIN
  SELECT id INTO v_menu FROM public.events
   WHERE brand_id=v_brand AND sales_mode='regular' AND slug='pos-playground-demo' LIMIT 1;
  IF v_menu IS NULL THEN
    INSERT INTO public.events(brand_id,name,slug,status,sales_mode,location)
    VALUES(v_brand,'POS Playground — DEMO','pos-playground-demo','published','Training / Demo Only')
    RETURNING id INTO v_menu;
  END IF;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Espresso' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Espresso',120,'A double shot of espresso',true,'Coffee',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,0,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Cappuccino' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Cappuccino',180,'Espresso with velvety steamed milk',true,'Coffee','https://images.unsplash.com/photo-1570968915860-54d5c301fa9f?w=720&q=80')
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,1,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Small',160,0)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Medium',180,1)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Large',220,2)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_allowed_addons(brand_id,product_id,addon_id)
    SELECT v_brand,v_product,a.id FROM public.product_addons a
    WHERE a.brand_id=v_brand AND a.is_active AND a.name IN ('Almond Milk','Vanilla Syrup')
    ON CONFLICT DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Flat White' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Flat White',200,'Rich espresso and silky milk',true,'Coffee',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,2,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Iced Latte' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Iced Latte',220,'Chilled espresso, milk and ice',true,'Iced Coffee','https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=720&q=80')
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,3,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Small',190,0)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Medium',220,1)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Large',260,2)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_allowed_addons(brand_id,product_id,addon_id)
    SELECT v_brand,v_product,a.id FROM public.product_addons a
    WHERE a.brand_id=v_brand AND a.is_active AND a.name IN ('Almond Milk','Vanilla Syrup')
    ON CONFLICT DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Vanilla Cold Brew' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Vanilla Cold Brew',240,'Slow-steeped cold brew with vanilla',true,'Cold Brew',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,4,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Mocha' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Mocha',250,'Chocolate espresso with steamed milk',true,'Coffee',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,5,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Small',210,0)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Medium',250,1)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_sizes(brand_id,product_id,name,price,display_order)
  VALUES(v_brand,v_product,'Large',290,2)
  ON CONFLICT(product_id,name) DO NOTHING;
  INSERT INTO public.product_allowed_addons(brand_id,product_id,addon_id)
    SELECT v_brand,v_product,a.id FROM public.product_addons a
    WHERE a.brand_id=v_brand AND a.is_active AND a.name IN ('Almond Milk','Vanilla Syrup')
    ON CONFLICT DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · V60 Pour Over' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · V60 Pour Over',230,'Freshly hand-brewed filter coffee',true,'Brew Bar',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,6,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Matcha Latte' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Matcha Latte',260,'Creamy whisked matcha milk',true,'Tea',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,7,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Hot Chocolate' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Hot Chocolate',210,'Rich cocoa and warm milk',true,'Chocolate',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,8,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Butter Croissant' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Butter Croissant',170,'Buttery and flaky baked pastry',true,'Bakery','https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=720&q=80')
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,9,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Chocolate Brownie' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Chocolate Brownie',190,'Fudgy chocolate brownie',true,'Bakery',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,10,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;

  SELECT id INTO v_product FROM public.products WHERE brand_id=v_brand AND name='DEMO · Grilled Sandwich' LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(brand_id,name,price,description,is_active,category,demo_photo_url)
    VALUES(v_brand,'DEMO · Grilled Sandwich',240,'Toasted sandwich with cheese and vegetables',true,'Food',NULL)
    RETURNING id INTO v_product;
  END IF;
  INSERT INTO public.event_products(event_id,product_id,display_order,is_available,inventory_tracking)
  VALUES(v_menu,v_product,11,true,false)
  ON CONFLICT(event_id,product_id) DO NOTHING;
END $seed$;
