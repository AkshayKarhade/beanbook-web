import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminSupabase } from './client';
import ProductOptions from './ProductOptions';

type Product = { id: string; name: string; description: string | null; price: number; is_active: boolean; created_at: string };
type FormValues = { name: string; description: string; price: string };
const empty: FormValues = { name: '', description: '', price: '' };
const money = (value: number) => '₹' + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const control = 'w-full rounded-xl border border-[#d5d7d0] bg-white px-4 py-3 text-sm text-zinc-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10';
const primary = 'rounded-xl bg-[#1b2822] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<FormValues>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const request = useCallback(async (payload?: Record<string, unknown>) => {
    if (!adminSupabase) throw new Error('Business connection is unavailable.');
    const { data, error: authError } = await adminSupabase.auth.getSession();
    if (authError || !data.session?.access_token) throw new Error('Your session has expired. Sign in again.');
    const response = await fetch('/api/business-products', {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + data.session.access_token, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Product service is unavailable (HTTP ' + response.status + '). Please check the Netlify preview deployment.');
    }
    const result = await response.json() as { products?: Product[]; error?: string };
    if (!response.ok) throw new Error(result.error || 'Could not complete the request (HTTP ' + response.status + ').');
    return result;
  }, []);

  const refresh = useCallback(async () => {
    const result = await request();
    setProducts(result.products ?? []);
  }, [request]);

  useEffect(() => {
    let active = true;
    void refresh().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load products.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  function startAdd() { setEditingId(null); setForm(empty); setShowForm(true); setError(''); setNotice(''); }
  function startEdit(product: Product) {
    setEditingId(product.id);
    setForm({ name: product.name, description: product.description || '', price: String(product.price) });
    setShowForm(true); setError(''); setNotice('');
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await request({ action: editingId ? 'update' : 'create', ...(editingId ? { productId: editingId } : {}),
        name: form.name, description: form.description, price: form.price });
      await refresh();
      setShowForm(false); setEditingId(null); setForm(empty);
      setNotice(editingId ? 'Product updated.' : 'Product added to your catalogue.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save product.'); }
    finally { setSaving(false); }
  }
  async function setActive(product: Product) {
    setSaving(true); setError(''); setNotice('');
    try {
      await request({ action: 'setActive', productId: product.id, active: !product.is_active });
      await refresh();
      setNotice(product.is_active ? 'Product archived. Existing orders are preserved.' : 'Product activated.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change product status.'); }
    finally { setSaving(false); }
  }

  return <section className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h3 className="text-xl font-semibold">Your products</h3><p className="mt-2 text-sm text-zinc-500">Add drinks or food, set prices and manage what's available. Products belong only to your business.</p></div>
      <button type="button" onClick={startAdd} className={primary}>+ Add product</button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
    {showForm && <form onSubmit={e => void save(e)} className="space-y-4 rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center justify-between gap-4"><h4 className="text-lg font-semibold">{editingId ? 'Edit product' : 'Add a product'}</h4><button type="button" className="text-sm text-zinc-600 underline" onClick={() => setShowForm(false)}>Cancel</button></div>
      <label className="block text-sm font-medium">Product name <span className="text-red-700">*</span><input className={control + ' mt-2'} required minLength={2} maxLength={120} placeholder="e.g. Cappuccino" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></label>
      <label className="block text-sm font-medium">Price (₹) <span className="text-red-700">*</span><input className={control + ' mt-2'} required min="0.01" max="100000" step="0.01" type="number" inputMode="decimal" placeholder="e.g. 180" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}/></label>
      <label className="block text-sm font-medium">Description <span className="font-normal text-zinc-500">(optional)</span><textarea className={control + ' mt-2'} rows={3} maxLength={500} placeholder="What makes it special?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/></label>
      <button className={primary} disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save product'}</button>
    </form>}
    {loading ? <p className="py-8 text-sm text-zinc-500">Loading products…</p> :
      products.length === 0 ? <div className="rounded-2xl border border-dashed border-[#d5d7d0] bg-white p-8 text-center">
        <h4 className="text-lg font-semibold">Your catalogue is empty</h4>
        <p className="mt-2 text-sm text-zinc-500">Start by adding your first product.</p>
        <button type="button" onClick={startAdd} className={primary + ' mt-5'}>Add your first product</button>
      </div> : <div className="space-y-3">{products.map(p =>
        <article key={p.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sm">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{p.name}</h4>{!p.is_active && <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">Archived</span>}</div>
            {p.description && <p className="mt-1 text-sm text-zinc-500">{p.description}</p>}
            <p className="mt-2 font-semibold text-[#1b2822]">{money(p.price)}</p></div>
          <div className="flex gap-2"><button type="button" disabled={saving} onClick={() => startEdit(p)} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium">Edit</button>
            <button type="button" disabled={saving} onClick={() => void setActive(p)} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium">{p.is_active ? 'Archive' : 'Activate'}</button></div>
        </article>)}</div>}
    <ProductOptions products={products} />
    <p className="text-xs text-zinc-500">Archiving removes a product from the active catalogue without deleting its order history. Menu and event assignment will be added separately.</p>
  </section>;
}
