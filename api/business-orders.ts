import { createClient } from '@supabase/supabase-js';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
type Action = 'create' | 'addItems' | 'advanceItem' | 'cancelItem' | 'editItem' | 'beginSettlement' | 'confirmPayment' | 'saveBillingMode';
type Input = Record<string, unknown> & { action?: Action };

export default async function businessOrders(req: Request) {
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
  if (req.method === 'POST' && req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return json({ error: 'Cross-origin request blocked' }, 403);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return json({ error: 'Orders backend unavailable' }, 503);
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Sign in required' }, 401);
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: identity, error: identityError } = await db.auth.getUser(token);
    if (identityError || !identity.user || identity.user.is_anonymous) return json({ error: 'Session expired' }, 401);
    const { data: member, error: membershipError } = await db.from('admin_users').select('brand_id,role').eq('supabase_user_id', identity.user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!member || !['owner', 'staff'].includes(member.role)) return json({ error: 'Business staff access required' }, 403);
    const brandId = member.brand_id as string;
    if (req.method === 'GET') {
      const settings = await db.from('business_billing_settings').select('billing_mode').eq('brand_id', brandId).maybeSingle();
      if (settings.error) throw settings.error;
      const orders = await db.from('orders')
        .select('id,order_number,event_id,customer_id,total_amount,created_at,closed_at,payment_status,paid_at,billing_mode,billing_status,workflow_version,order_status,order_channel,customers(name,phone),order_items(id,product_id,quantity,unit_price,size_name,fulfillment_status,round_number,cancelled_at,prep_started_at,prep_ready_at,products(name),order_item_addons(addon_id,addon_name,unit_price))')
        .eq('brand_id', brandId).eq('workflow_version', 2)
        .order('created_at', { ascending: false }).limit(150);
      if (orders.error) throw orders.error;
      // Do not expose unversioned legacy payment attempts as live preparation tickets.
      return json({ billingMode: settings.data?.billing_mode || 'pay_first', orders: orders.data || [] });
    }
    if (!(req.headers.get('content-type') || '').toLowerCase().includes('application/json')) return json({ error: 'JSON required' }, 415);
    const body: unknown = await req.json().catch(() => null);
    if (!isObject(body)) return json({ error: 'Invalid request' }, 400);
    const input = body as Input;
    if (input.action === 'saveBillingMode') {
      if (member.role !== 'owner') return json({ error: 'Business Admin access required' }, 403);
      if (input.billingMode !== 'pay_first' && input.billingMode !== 'open_bill') return json({ error: 'Invalid billing mode' }, 400);
      const { error } = await db.from('business_billing_settings').upsert({ brand_id: brandId, billing_mode: input.billingMode, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true, billingMode: input.billingMode });
    }
    const actor = identity.user.id;
    let functionName: string;
    let args: Record<string, unknown>;
    switch (input.action) {
      case 'create':
        if (!uuid(input.menuId) || !uuid(input.requestId) || typeof input.customerName !== 'string' || typeof input.customerPhone !== 'string' || !Array.isArray(input.items) || !['pay_first','open_bill'].includes(String(input.billingMode))) return json({ error: 'Invalid order details or payment timing' }, 400);
        functionName = 'beanbook_create_counter_order_v4';
        args = { p_brand_id: brandId, p_menu_id: input.menuId, p_name: input.customerName, p_phone: input.customerPhone, p_items: input.items, p_actor: actor, p_request_id: input.requestId, p_billing_mode: input.billingMode };
        break;
      case 'addItems':
        if (!uuid(input.orderId) || !uuid(input.requestId) || !Array.isArray(input.items)) return json({ error: 'Invalid item addition' }, 400);
        functionName = 'beanbook_add_open_bill_items';
        args = { p_brand_id: brandId, p_order_id: input.orderId, p_actor: actor, p_request_id: input.requestId, p_items: input.items };
        break;
      case 'advanceItem':
        if (!uuid(input.itemId) || !['preparing', 'ready', 'completed'].includes(String(input.nextStatus))) return json({ error: 'Invalid fulfillment update' }, 400);
        functionName = 'beanbook_change_item_fulfillment';
        args = { p_brand_id: brandId, p_order_item_id: input.itemId, p_actor: actor, p_next: input.nextStatus };
        break;
      case 'cancelItem':
        if (!uuid(input.itemId) || typeof input.reason !== 'string') return json({ error: 'Invalid cancellation' }, 400);
        functionName = 'beanbook_cancel_open_bill_item';
        args = { p_brand_id: brandId, p_order_item_id: input.itemId, p_actor: actor, p_reason: input.reason };
        break;
      case 'editItem':
        if (!uuid(input.itemId) || !uuid(input.requestId) || !Array.isArray(input.addonIds) || (input.sizeName !== null && typeof input.sizeName !== 'string')) return json({ error: 'Invalid item edit' }, 400);
        functionName = 'beanbook_edit_unprepared_bill_item';
        args = { p_brand_id: brandId, p_order_item_id: input.itemId, p_actor: actor, p_request_id: input.requestId, p_size_name: input.sizeName ?? null, p_addon_ids: input.addonIds };
        break;
      case 'beginSettlement':
        if (!uuid(input.orderId)) return json({ error: 'Invalid order' }, 400);
        functionName = 'beanbook_begin_bill_settlement';
        args = { p_brand_id: brandId, p_order_id: input.orderId, p_actor: actor };
        break;
      case 'confirmPayment':
        if (typeof input.orderNumber !== 'string' || !/^BB-POS-[A-F0-9]{12}$/.test(input.orderNumber) || !['upi', 'cash'].includes(String(input.paymentMethod))) return json({ error: 'Invalid payment confirmation' }, 400);
        functionName = 'beanbook_confirm_counter_payment';
        args = { p_brand_id: brandId, p_order_number: input.orderNumber, p_staff_user: actor, p_payment_method: input.paymentMethod, p_reference: typeof input.transactionReference === 'string' ? input.transactionReference.trim() : null };
        break;
      default: return json({ error: 'Unknown action' }, 400);
    }
    const result = await db.rpc(functionName, args);
    if (result.error) {
      if (['22023', '23505', '42501'].includes(result.error.code)) return json({ error: result.error.message }, result.error.code === '42501' ? 403 : 409);
      throw result.error;
    }
    return json({ ok: true, result: result.data });
  } catch (error) {
    console.error('Business orders operation failed', error);
    return json({ error: 'Order operation failed; refresh the order before retrying.' }, 500);
  }
}
