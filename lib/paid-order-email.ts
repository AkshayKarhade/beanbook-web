import { supabaseAdmin } from './supabase-server';

type OrderRow = {
  id: string; order_number: string; total_amount: number; event_id: string;
  payment_status: string; created_at: string; paid_at: string | null;
  fulfillment_type: string | null; delivery_address: string | null;
  delivery_phone: string | null; customer_id: string | null;
};
const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c] ?? c);
const money = (v: number) => '₹' + Number(v).toFixed(2);
const time = (v: string | null) => v
  ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v))
  : 'Not available';

/**
 * Best-effort email; must NEVER affect a successful payment response.
 * The database claim prevents webhook and checkout from sending simultaneously.
 * Resend's stable idempotency key handles repeats after a request timeout.
 */
export async function notifyPaidOrder(orderId: string): Promise<void> {
  if (!process.env.RESEND_API_KEY || !process.env.ORDER_EMAIL_FROM || !process.env.ORDER_EMAIL_TO) {
    console.warn('Paid-order email skipped: configure RESEND_API_KEY, ORDER_EMAIL_FROM and ORDER_EMAIL_TO');
    return;
  }
  try {
    const { data: claimed, error: claimError } = await supabaseAdmin.rpc('claim_paid_order_email_notification', { p_order_id: orderId });
    if (claimError) throw claimError;
    if (claimed !== true) return;

    const { data: row, error: orderError } = await supabaseAdmin.from('orders')
      .select('id, order_number, total_amount, event_id, payment_status, created_at, paid_at, fulfillment_type, delivery_address, delivery_phone, customer_id')
      .eq('id', orderId).single();
    if (orderError) throw orderError;
    const order = row as OrderRow;
    const [eventResult, itemResult, summaryResult, customerResult] = await Promise.all([
      supabaseAdmin.from('events').select('name').eq('id', order.event_id).single(),
      supabaseAdmin.from('order_items').select('quantity, unit_price, products(name)').eq('order_id', orderId),
      supabaseAdmin.rpc('get_paid_event_preparation_summary', { p_event_id: order.event_id }),
      order.customer_id ? supabaseAdmin.from('customers').select('name, phone').eq('id', order.customer_id).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    for (const result of [eventResult, itemResult, summaryResult, customerResult]) if (result.error) throw result.error;

    const eventName = eventResult.data?.name ?? 'Unknown event';
    const items = (itemResult.data ?? []).map((item: any) => ({
      name: (Array.isArray(item.products) ? item.products[0]?.name : item.products?.name) ?? 'Unknown product',
      quantity: Number(item.quantity), price: Number(item.unit_price)
    }));
    const summary = summaryResult.data as { paid_orders?: number; total_bottles?: number; items?: { name: string; quantity: number }[] } | null;
    const subject = `Paid order ${order.order_number} • ${eventName} • ${money(order.total_amount)}`;
    const lines = items.map(i => `<tr><td style="padding:6px;border-bottom:1px solid #ddd">${escapeHtml(i.name)}</td><td>${i.quantity}</td><td>${escapeHtml(money(i.quantity * i.price))}</td></tr>`).join('');
    const preparation = (summary?.items ?? []).map(i => `<li>${escapeHtml(i.name)}: <b>${i.quantity}</b></li>`).join('');
    const html = `<h2>Payment confirmed — ${escapeHtml(eventName)}</h2>
      <p><b>Order:</b> ${escapeHtml(order.order_number)}<br>
      <b>Paid:</b> ${escapeHtml(time(order.paid_at))} IST<br>
      <b>Status:</b> ${escapeHtml(order.payment_status)}<br>
      <b>Amount:</b> ${escapeHtml(money(order.total_amount))}</p>
      <h3>Prepare this order</h3><table style="width:100%;text-align:left"><tr><th>Product</th><th>Qty</th><th>Amount</th></tr>${lines}</table>
      <p><b>Customer:</b> ${escapeHtml(customerResult.data?.name ?? 'Guest')}<br>
      <b>Phone:</b> ${escapeHtml(customerResult.data?.phone ?? 'Not provided')}<br>
      <b>Fulfilment:</b> ${escapeHtml(order.fulfillment_type ?? 'Event pickup')}<br>
      ${order.delivery_address ? `<b>Delivery address:</b> ${escapeHtml(order.delivery_address)}<br>` : ''}
      ${order.delivery_phone ? `<b>Delivery phone:</b> ${escapeHtml(order.delivery_phone)}` : ''}</p>
      <h3>${escapeHtml(eventName)} — confirmed totals</h3>
      <p><b>Paid orders:</b> ${summary?.paid_orders ?? 0}<br>
      <b>Units to prepare:</b> ${summary?.total_bottles ?? 0}</p><ul>${preparation}</ul>
      ${order.payment_status === 'paid_stock_issue' ? '<p><b>Action required:</b> Payment succeeded but stock could not be deducted. Check inventory.</p>' : ''}
      <p><small>BeanBook | Paid orders only. Reconciliation remains in the database.</small></p>`;

    // Persist the rendered snapshot before delivery so retries reuse the same body.
    const { error: snapshotError } = await supabaseAdmin.from('order_email_notifications').update({
      email_subject: subject, email_body: html
    }).eq('order_id', orderId).eq('status', 'sending');
    if (snapshotError) throw snapshotError;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `beanbook-paid-order-${orderId}` },
      body: JSON.stringify({ from: process.env.ORDER_EMAIL_FROM, to: [process.env.ORDER_EMAIL_TO], subject, html })
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok || !payload.id) throw new Error(`Resend ${response.status}: ${payload.message ?? 'Email not accepted'}`);
    const { error: markError } = await supabaseAdmin.from('order_email_notifications').update({
      status: 'sent', sent_at: new Date().toISOString(), provider_email_id: payload.id, last_error: null
    }).eq('order_id', orderId);
    if (markError) throw markError;
  } catch (error) {
    console.error('Paid-order email failed', orderId, error);
    await supabaseAdmin.from('order_email_notifications').update({
      status: 'failed', last_error: String(error instanceof Error ? error.message : error).slice(0, 1000)
    }).eq('order_id', orderId).eq('status', 'sending');
  }
}
