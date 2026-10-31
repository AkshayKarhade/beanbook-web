import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase-server';

type Payload = Record<string, unknown>;
type OrderLine = { productId: string; quantity: number };
type Product = { id: string; name: string; price: number; brand_id: string; is_active: boolean };
type MenuProduct = { product_id: string; price_override: number | null; is_available: boolean };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errorResponse = (message: string, status = 400) => Response.json({ error: message }, { status });
const validId = (id: unknown): id is string => typeof id === 'string' && uuidPattern.test(id);
const cleanText = (value: unknown, max = 120) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

async function readWorkspace(brandId: string) {
  const [brand, menus, products, orders] = await Promise.all([
    supabaseAdmin.from('brands').select('id,name').eq('id', brandId).single(),
    supabaseAdmin.from('events')
      .select('id,name,slug,status,event_start_date,event_end_date,location,created_at')
      .eq('brand_id', brandId).order('created_at', { ascending: false }),
    supabaseAdmin.from('products')
      .select('id,name,description,price,is_active').eq('brand_id', brandId)
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('orders')
      .select('id,order_number,event_id,total_amount,payment_status,created_at')
      .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(60),
  ]);
  if (brand.error || menus.error || products.error || orders.error) {
    throw new Error('Unable to load workspace');
  }
  const menuIds = (menus.data ?? []).map((menu) => menu.id);
  const associations = menuIds.length > 0
    ? await supabaseAdmin.from('event_products')
      .select('event_id,product_id,is_available,price_override,display_order')
      .in('event_id', menuIds)
    : { data: [], error: null };
  if (associations.error) throw associations.error;
  return {
    brand: brand.data, menus: menus.data ?? [], products: products.data ?? [],
    menuProducts: associations.data ?? [], orders: orders.data ?? [],
  };
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    // Authentication is verified by Supabase Auth; the business ID is NEVER read
    // from the request body. A service-role client is only used after that check.
    const authorization = request.headers.get('authorization') ?? '';
    const token = /^Bearer (.+)$/i.exec(authorization)?.[1];
    if (!token) return errorResponse('Sign in to continue', 401);

    try {
      const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !auth.user) return errorResponse('Session expired. Sign in again.', 401);

      const { data: member, error: memberError } = await supabaseAdmin
        .from('admin_users').select('brand_id,role')
        .eq('supabase_user_id', auth.user.id).maybeSingle();
      if (memberError) throw memberError;
      if (!member) return errorResponse('No business is assigned to this account', 403);
      const brandId: string = member.brand_id;

      if (request.method === 'GET') return Response.json(await readWorkspace(brandId));

      const body = (await request.json()) as Payload;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return errorResponse('Invalid request');
      }

      if (body.action === 'createMenu') {
        const kind = body.kind;
        if (kind !== 'regular' && kind !== 'event') return errorResponse('Choose a menu type');
        const name = kind === 'regular' ? 'Regular Sales' : cleanText(body.name);
        if (name.length < 2) return errorResponse('Enter an event name');

        if (kind === 'regular') {
          const { data: existing } = await supabaseAdmin.from('events').select('id')
            .eq('brand_id', brandId).eq('slug', `regular-${brandId.slice(0, 8)}`).maybeSingle();
          if (existing) return errorResponse('Regular Sales menu already exists');
        }
        const slug = kind === 'regular'
          ? `regular-${brandId.slice(0, 8)}`
          : `event-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 35)}-${randomUUID().slice(0, 8)}`;
        const start = cleanText(body.startDate, 10);
        const end = cleanText(body.endDate, 10);
        if ((start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) || (start && end && end < start)) {
          return errorResponse('Check the event dates');
        }

        const { data: menu, error: insertError } = await supabaseAdmin.from('events')
          .insert({
            brand_id: brandId, name, slug, status: 'active',
            event_start_date: kind === 'event' && start ? start : null,
            event_end_date: kind === 'event' && end ? end : null,
            location: kind === 'event' ? cleanText(body.location, 160) || null : null,
          }).select('id,slug').single();
        if (insertError || !menu) throw insertError ?? new Error('Could not create menu');

        // Existing menu/checkout APIs expect an inventory unit per event.
        // Pilot sales are made to order, so there is no stock limit yet.
        const { error: unitError } = await supabaseAdmin.from('inventory_units').insert({
          brand_id: brandId, code: slug, name,
          legacy_event_id: menu.id, unit_type: kind === 'regular' ? 'other' : 'popup',
          status: 'active', track_inventory: false,
        });
        if (unitError) {
          await supabaseAdmin.from('events').delete().eq('id', menu.id).eq('brand_id', brandId);
          throw unitError;
        }
        return Response.json({ ok: true, menuId: menu.id, slug });
      }

      if (body.action === 'createProduct') {
        const name = cleanText(body.name);
        const price = Number(body.price);
        if (name.length < 2 || !Number.isFinite(price) || price <= 0 || price > 100000 ||
            Math.round(price * 100) !== price * 100) {
          return errorResponse('Enter a product name and valid price');
        }
        const { data, error } = await supabaseAdmin.from('products').insert({
          brand_id: brandId, name, description: cleanText(body.description, 500) || null,
          price, is_active: true,
        }).select('id').single();
        if (error) throw error;
        return Response.json({ ok: true, productId: data?.id });
      }

      if (body.action === 'addProduct' || body.action === 'removeProduct') {
        if (!validId(body.menuId) || !validId(body.productId)) return errorResponse('Invalid menu or item');
        const [menu, product] = await Promise.all([
          supabaseAdmin.from('events').select('id').eq('id', body.menuId).eq('brand_id', brandId).maybeSingle(),
          supabaseAdmin.from('products').select('id').eq('id', body.productId).eq('brand_id', brandId).eq('is_active', true).maybeSingle(),
        ]);
        if (menu.error || product.error) throw menu.error ?? product.error;
        if (!menu.data || !product.data) return errorResponse('Menu or product not found', 404);
        const { error } = await supabaseAdmin.from('event_products').upsert({
          event_id: menu.data.id, product_id: product.data.id,
          is_available: body.action === 'addProduct',
        }, { onConflict: 'event_id,product_id' });
        if (error) throw error;
        return Response.json({ ok: true });
      }

      if (body.action === 'setMenuStatus') {
        if (!validId(body.menuId) || (body.status !== 'active' && body.status !== 'inactive')) {
          return errorResponse('Invalid menu status');
        }
        const { data, error } = await supabaseAdmin.from('events').update({ status: body.status })
          .eq('id', body.menuId).eq('brand_id', brandId).select('id').maybeSingle();
        if (error) throw error;
        if (!data) return errorResponse('Menu not found', 404);
        return Response.json({ ok: true });
      }

      if (body.action === 'recordOrder') {
        if (!validId(body.menuId) || !Array.isArray(body.items) ||
          !['unpaid', 'received'].includes(String(body.payment))) {
          return errorResponse('Choose a menu, items and payment status');
        }
        const items = body.items as OrderLine[];
        if (items.length === 0 || items.length > 40 ||
          items.some(item => !validId(item?.productId) || !Number.isInteger(item.quantity) ||
            item.quantity < 1 || item.quantity > 100) ||
          new Set(items.map(item => item.productId)).size !== items.length) {
          return errorResponse('Invalid items or quantities');
        }
        const [menu, unit, associations, products] = await Promise.all([
          supabaseAdmin.from('events').select('id').eq('id', body.menuId)
            .eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
          supabaseAdmin.from('inventory_units').select('id,track_inventory')
            .eq('legacy_event_id', body.menuId).eq('brand_id', brandId).maybeSingle(),
          supabaseAdmin.from('event_products').select('product_id,is_available,price_override')
            .eq('event_id', body.menuId).eq('is_available', true)
            .in('product_id', items.map(item => item.productId)),
          supabaseAdmin.from('products').select('id,name,price,brand_id,is_active')
            .eq('brand_id', brandId).eq('is_active', true)
            .in('id', items.map(item => item.productId)),
        ]);
        if (menu.error || unit.error || associations.error || products.error) {
          throw menu.error ?? unit.error ?? associations.error ?? products.error;
        }
        if (!menu.data || !unit.data) return errorResponse('Menu is unavailable', 404);
        // Counter sales never bypass stock tracking for existing inventory-managed events.
        if (unit.data.track_inventory) return errorResponse('Stock-managed menu requires the normal checkout flow');
        if (associations.data?.length !== items.length || products.data?.length !== items.length) {
          return errorResponse('Some items are not on this menu');
        }
        const itemById = new Map((products.data as Product[]).map(row => [row.id, row]));
        const priceById = new Map((associations.data as MenuProduct[]).map(row => [row.product_id, row]));
        const lines = items.map(item => {
          const product = itemById.get(item.productId);
          const association = priceById.get(item.productId);
          if (!product || !association) throw new Error('Product is unavailable');
          const price = Number(association.price_override ?? product.price);
          if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid product price');
          return { product_id: item.productId, quantity: item.quantity, unit_price: price };
        });
        const total = lines.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
        const received = body.payment === 'received';
        const { data: order, error: orderError } = await supabaseAdmin.from('orders').insert({
          brand_id: brandId, event_id: menu.data.id, inventory_unit_id: unit.data.id,
          order_number: `BB-${randomUUID().slice(0, 8).toUpperCase()}`,
          total_amount: Math.round(total * 100) / 100,
          payment_status: received ? 'paid' : 'pending', order_status: 'preparing',
        }).select('id,order_number,total_amount').single();
        if (orderError || !order) throw orderError ?? new Error('Could not create order');
        const { error: lineError } = await supabaseAdmin.from('order_items')
          .insert(lines.map(line => ({ ...line, order_id: order.id })));
        if (lineError) {
          await supabaseAdmin.from('orders').delete().eq('id', order.id).eq('brand_id', brandId);
          throw lineError;
        }
        // An operator assertion, not online payment verification.
        await supabaseAdmin.from('platform_audit').insert({
          actor_user_id: auth.user.id, brand_id: brandId, action: 'counter_order_recorded',
          details: { order_id: order.id, payment_received: received },
        });
        return Response.json({ ok: true, order });
      }

      if (body.action === 'markPaid') {
        if (!validId(body.orderId)) return errorResponse('Invalid order');
        const { data, error } = await supabaseAdmin.from('orders')
          .update({ payment_status: 'paid', paid_at: new Date().toISOString() })
          .eq('id', body.orderId).eq('brand_id', brandId)
          .eq('payment_status', 'pending').select('id').maybeSingle();
        if (error) throw error;
        if (!data) return errorResponse('Order is already paid or was not found');
        await supabaseAdmin.from('platform_audit').insert({
          actor_user_id: auth.user.id, brand_id: brandId, action: 'counter_order_marked_paid',
          details: { order_id: data.id },
        });
        return Response.json({ ok: true });
      }
      return errorResponse('Unsupported action');
    } catch (error) {
      console.error('Business workspace request failed', error);
      return errorResponse('Could not complete the request. Please retry.', 500);
    }
  },
};
