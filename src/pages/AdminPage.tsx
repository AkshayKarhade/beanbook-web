import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Menu = { id: string; name: string; slug: string; status: string };
type Product = { id: string; name: string; price: number; is_active: boolean };
type Row = { event_id: string; product_id: string; is_available: boolean };
type Order = { id: string; order_number: string; total_amount: number; payment_status: string };
type Data = { brand: { name: string }; menus: Menu[]; products: Product[]; menuProducts: Row[]; orders: Order[] };
const field = 'w-full rounded-lg border bg-white px-3 py-2 text-black';
const button = 'rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-40';

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [login, setLogin] = useState({ email: '', password: '' });
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'orders' | 'menus' | 'products'>('orders');
  const [menuKind, setMenuKind] = useState('event');
  const [newMenu, setNewMenu] = useState({ name: '', location: '', startDate: '', endDate: '' });
  const [product, setProduct] = useState({ name: '', price: '', description: '' });
  const [menuId, setMenuId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState('received');
  const [message, setMessage] = useState('');

  async function refresh(access: string) {
    const response = await fetch('/api/business-workspace', { headers: { Authorization: 'Bearer ' + access } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Workspace unavailable');
    setData(body as Data);
    setMenuId(current => (body.menus as Menu[]).some(m => m.id === current && m.status === 'active') ? current : (body.menus as Menu[]).find(m => m.status === 'active')?.id || '');
  }
  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data: auth }) => {
      if (auth.session) {
        setToken(auth.session.access_token);
        try { await refresh(auth.session.access_token); } catch (e) { setError(String(e)); }
      }
    });
  }, []);

  async function run(action: Record<string, unknown>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      const { data: auth } = await supabase.auth.getSession();
      const access = auth.session?.access_token;
      if (!access) throw new Error('Session expired; sign in again');
      const response = await fetch('/api/business-workspace', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Request failed');
      await refresh(access);
      setMessage(body.order ? success + ': ' + body.order.order_number : success);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); return false; }
    finally { setBusy(false); }
  }
  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data: auth, error: authError } = await supabase.auth.signInWithPassword(login);
      if (authError || !auth.session) throw authError || new Error('Sign in failed');
      setToken(auth.session.access_token);
      await refresh(auth.session.access_token);
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign in failed'); }
    finally { setBusy(false); }
  }

  if (!token) return <form onSubmit={e => void signIn(e)} className="mx-auto max-w-md space-y-4 rounded-xl border p-6">
    <h1 className="text-2xl font-bold">BeanBook Business Login</h1>
    <input aria-label="Email" className={field} type="email" placeholder="Email" required value={login.email} onChange={e => setLogin({ ...login, email: e.target.value })}/>
    <input aria-label="Password" className={field} type="password" placeholder="Password" required value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })}/>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <button disabled={busy} className={button}>Sign in</button>
  </form>;
  if (!data) return <section><p>{error || 'Loading business...'}</p><button className={button} onClick={() => void supabase.auth.signOut().then(() => { setToken(''); setData(null); })}>Sign out</button></section>;
  const products = data.products.filter(p => p.is_active);
  const available = products.filter(p => data.menuProducts.some(r => r.event_id === menuId && r.product_id === p.id && r.is_available));
  const selected = available.filter(p => (quantities[p.id] || 0) > 0);
  const total = selected.reduce((sum, p) => sum + Number(p.price) * quantities[p.id], 0);

  return <section className="mx-auto max-w-4xl space-y-6 pb-16">
    <div className="flex justify-between gap-4"><div><p className="text-sm text-gray-500">BeanBook</p><h1 className="text-2xl font-bold">{data.brand.name}</h1></div><button className="underline" onClick={() => void supabase.auth.signOut().then(() => { setToken(''); setData(null); })}>Sign out</button></div>
    {error && <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-600">{error}</p>}
    {message && <p role="status" className="rounded-lg border p-3">{message}</p>}
    <nav className="flex flex-wrap gap-2">{(['orders','menus','products'] as const).map(t => <button key={t} className={t === tab ? button : 'rounded-lg border px-4 py-2'} onClick={() => setTab(t)}>{t === 'orders' ? 'Counter order' : t === 'menus' ? 'Menus & events' : 'Products'}</button>)}</nav>

    {tab === 'products' && <div className="space-y-4"><h2 className="text-xl font-bold">Add product</h2>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); if (await run({ action: 'createProduct', ...product }, 'Product created')) setProduct({ name: '', price: '', description: '' }); }}>
        <input className={field} placeholder="Product name" required value={product.name} onChange={e => setProduct({ ...product, name: e.target.value })}/>
        <input className={field} placeholder="Price ₹" type="number" step="0.01" min="0.01" required value={product.price} onChange={e => setProduct({ ...product, price: e.target.value })}/>
        <input className={field + ' sm:col-span-2'} placeholder="Description (optional)" value={product.description} onChange={e => setProduct({ ...product, description: e.target.value })}/>
        <button className={button} disabled={busy}>Save product</button>
      </form>
      {products.map(p => <p key={p.id} className="flex justify-between border-b py-3"><span>{p.name}</span><strong>₹{p.price}</strong></p>)}
    </div>}

    {tab === 'menus' && <div className="space-y-4"><h2 className="text-xl font-bold">Create menu</h2>
      <form className="space-y-3 rounded-xl border p-4" onSubmit={async e => { e.preventDefault(); if (await run({ action: 'createMenu', kind: menuKind, ...newMenu }, 'Menu created')) setNewMenu({ name: '', location: '', startDate: '', endDate: '' }); }}>
        <select aria-label="Menu type" className={field} value={menuKind} onChange={e => setMenuKind(e.target.value)}><option value="regular">Regular sales</option><option value="event">Event</option></select>
        {menuKind === 'event' && <>
          <input className={field} placeholder="Event name" required value={newMenu.name} onChange={e => setNewMenu({ ...newMenu, name: e.target.value })}/>
          <input className={field} placeholder="Location" value={newMenu.location} onChange={e => setNewMenu({ ...newMenu, location: e.target.value })}/>
          <label className="block text-sm">Start date<input className={field} type="date" value={newMenu.startDate} onChange={e => setNewMenu({ ...newMenu, startDate: e.target.value })}/></label>
          <label className="block text-sm">End date<input className={field} type="date" min={newMenu.startDate || undefined} value={newMenu.endDate} onChange={e => setNewMenu({ ...newMenu, endDate: e.target.value })}/></label>
        </>}
        <button className={button} disabled={busy}>Create {menuKind === 'regular' ? 'regular menu' : 'event'}</button>
      </form>
      {data.menus.map(m => <article key={m.id} className="space-y-3 rounded-xl border p-4">
        <div className="flex justify-between"><strong>{m.name}</strong><span>{m.status}</span></div>
        <p className="text-sm text-gray-500">Counter ordering is ready. Public checkout requires this business to connect its own payment account.</p>
        <div className="flex flex-wrap gap-2">{products.map(p => {
          const linked = data.menuProducts.some(r => r.event_id === m.id && r.product_id === p.id && r.is_available);
          return <button key={p.id} disabled={busy} className="rounded-lg border px-3 py-2" onClick={() => void run({ action: linked ? 'removeProduct' : 'addProduct', menuId: m.id, productId: p.id }, 'Menu updated')}>{linked ? '✓ ' : '+ '}{p.name}</button>;
        })}</div>
        <button className="underline" disabled={busy} onClick={() => void run({ action: 'setMenuStatus', menuId: m.id, status: m.status === 'active' ? 'inactive' : 'active' }, 'Menu updated')}>{m.status === 'active' ? 'Pause menu' : 'Activate menu'}</button>
      </article>)}
    </div>}

    {tab === 'orders' && <div className="space-y-4"><h2 className="text-xl font-bold">Record a sale</h2>
      <p className="text-sm text-gray-500">For cash / UPI payments collected directly by the business. No online payment verification.</p>
      <select aria-label="Order menu" className={field} value={menuId} onChange={e => { setMenuId(e.target.value); setQuantities({}); }}><option value="">Choose a menu</option>{data.menus.filter(m => m.status === 'active').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {available.map(p => <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border p-3"><div><strong>{p.name}</strong><p>₹{p.price}</p></div><div className="flex items-center gap-3"><button aria-label={'Remove ' + p.name} className="rounded border px-3 py-1" onClick={() => setQuantities(q => ({ ...q, [p.id]: Math.max(0, (q[p.id] || 0) - 1) }))}>−</button><span>{quantities[p.id] || 0}</span><button aria-label={'Add ' + p.name} className="rounded border px-3 py-1" onClick={() => setQuantities(q => ({ ...q, [p.id]: Math.min(100, (q[p.id] || 0) + 1) }))}>+</button></div></div>)}
      <div className="space-y-3 rounded-xl border p-4"><h3 className="text-xl font-bold">Total ₹{total}</h3>
        <select aria-label="Payment status" className={field} value={payment} onChange={e => setPayment(e.target.value)}><option value="received">Payment received (cash / UPI)</option><option value="unpaid">Payment pending</option></select>
        <button className={button + ' w-full'} disabled={busy || !menuId || !selected.length} onClick={async () => { if (await run({ action: 'recordOrder', menuId, payment, items: selected.map(p => ({ productId: p.id, quantity: quantities[p.id] })) }, 'Order recorded')) setQuantities({}); }}>Record order</button>
      </div>
      <h3 className="text-lg font-bold">Recent orders</h3>
      {data.orders.map(o => <div className="flex flex-wrap justify-between gap-2 rounded-lg border p-3" key={o.id}><strong>{o.order_number}</strong><span>₹{o.total_amount} · {o.payment_status}</span>{o.payment_status === 'pending' && <button className="underline" disabled={busy} onClick={() => void run({ action: 'markPaid', orderId: o.id }, 'Payment marked received')}>Mark paid</button>}</div>)}
    </div>}
  </section>;
}
