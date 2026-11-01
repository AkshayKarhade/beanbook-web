import { createClient } from '@supabase/supabase-js';
import businessOptions from './business-options';
import businessImages from './business-images';
import businessMenus from './business-menus';
import publicSalesMenu from './public-sales-menu';
import businessCustomers from './business-customers';
import businessOrders from './business-orders';


const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

type ProductInput = { name: string; description: string | null; price: number };

function parseProduct(input: Record<string, unknown>): ProductInput | null {
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 120) return null;
  if (input.description !== undefined && input.description !== null && typeof input.description !== 'string') return null;
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 500) return null;

  // Server-side validation: the client never determines the tenant or trusts the selling price.
  const price = typeof input.price === 'number' || typeof input.price === 'string'
    ? Number(input.price)
    : NaN;
  if (!Number.isFinite(price) || price <= 0 || price > 100000 ||
      Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) return null;

  return { name: input.name.trim(), description: description || null, price };
}

export default async function businessProducts(request: Request) {
  // Reuse the proven Products Netlify endpoint for catalogue configuration.
  // The options handler independently verifies the signed-in owner and tenant.
  if (new URL(request.url).searchParams.get('mode') === 'orders') return businessOrders(request);
  if (new URL(request.url).searchParams.get('mode') === 'customers') return businessCustomers(request);
  if (new URL(request.url).searchParams.get('mode') === 'public-menu') return publicSalesMenu(request);
  if (new URL(request.url).searchParams.get('mode') === 'menus') return businessMenus(request);
  if (new URL(request.url).searchParams.get('mode') === 'images') return businessImages(request);
  if (new URL(request.url).searchParams.get('mode') === 'options') {
    return businessOptions(request);
  }
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return json({ error: 'Cross-origin request blocked.' }, 403);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    return json({ error: 'Business products are not configured.' }, 503);
  }
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Sign in to continue.' }, 401);

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: identity, error: identityError } = await admin.auth.getUser(token);
    if (identityError || !identity.user || identity.user.is_anonymous) {
      return json({ error: 'Session expired. Please sign in again.' }, 401);
    }
    const { data: membership, error: membershipError } = await admin
      .from('admin_users')
      .select('brand_id,role')
      .eq('supabase_user_id', identity.user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || membership.role !== 'owner') {
      return json({ error: 'Business Owner access is required.' }, 403);
    }
    // brand_id is derived exclusively from a verified server-side membership.
    const brandId: string = membership.brand_id;
    const selectFields = 'id,name,description,price,is_active,created_at';

    if (request.method === 'GET') {
      const { data, error } = await admin.from('products')
        .select(selectFields)
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ products: data ?? [] });
    }

    if (!(request.headers.get('content-type') || '').includes('application/json')) {
      return json({ error: 'JSON body required.' }, 415);
    }
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: 'Request is too large.' }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON');
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    if (body.action === 'saveCatalog') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const sizes = body.sizes;
      const addonIds = body.addonIds;
      const editingId = body.productId;
      const validUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
      if (name.length < 2 || name.length > 120 || description.length > 500 ||
        !Array.isArray(sizes) || sizes.length > 12 || !Array.isArray(addonIds) ||
        addonIds.length > 50 || addonIds.some(v => !validUuid(v)) ||
        (editingId != null && !validUuid(editingId))) {
        return json({ error: 'Invalid product configuration.' }, 400);
      }
      const numeric = Number(body.price);
      if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100000 ||
          Math.abs(numeric * 100 - Math.round(numeric * 100)) > 0.00001) {
        return json({ error: 'Invalid product price.' }, 400);
      }
      const { data: saved, error: saveError } = await admin.rpc('beanbook_save_product_catalog', {
        p_brand_id: brandId, p_product_id: editingId || null,
        p_name: name, p_description: description, p_price: numeric,
        p_sizes: sizes, p_addon_ids: addonIds,
      });
      if (saveError) {
        if (saveError.code === '22023' || saveError.code === 'P0002')
          return json({ error: saveError.message }, 400);
        throw saveError;
      }
      return json({ ok: true, productId: saved });
    }

    if (body.action === 'create') {
      const fields = parseProduct(body);
      if (!fields) return json({ error: 'Enter a name (2–120 characters), price above ₹0 (up to ₹1,00,000) and optional description (up to 500 characters).' }, 400);
      const { data, error } = await admin.from('products')
        .insert({ ...fields, brand_id: brandId, is_active: true })
        .select(selectFields).single();
      if (error) throw error;
      return json({ product: data }, 201);
    }

    if (body.action === 'update') {
      const productId = body.productId;
      if (typeof productId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
        return json({ error: 'Invalid product.' }, 400);
      }
      const fields = parseProduct(body);
      if (!fields) return json({ error: 'Enter a valid product name, price and description.' }, 400);
      const { data, error } = await admin.from('products')
        .update(fields)
        .eq('id', productId)
        .eq('brand_id', brandId)
        .select(selectFields).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Product not found for your business.' }, 404);
      return json({ product: data });
    }

    if (body.action === 'setActive') {
      const productId = body.productId;
      if (typeof productId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId) ||
          typeof body.active !== 'boolean') {
        return json({ error: 'Invalid product status.' }, 400);
      }
      const { data, error } = await admin.from('products')
        .update({ is_active: body.active })
        .eq('id', productId)
        .eq('brand_id', brandId)
        .select(selectFields).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Product not found for your business.' }, 404);
      return json({ product: data });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('Business product request failed:', error);
    return json({ error: 'Unable to manage products right now. Please try again.' }, 500);
  }
}
