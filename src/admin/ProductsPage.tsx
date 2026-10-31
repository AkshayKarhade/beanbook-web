import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { adminSupabase } from './client';
import ProductOptions from './ProductOptions';
import ProductImages, {type ProductImagesHandle} from './ProductImages';

type Product = { id: string; name: string; description: string | null; price: number; is_active: boolean; created_at: string };
type FormValues = { name: string; description: string; price: string };
type SizeRow = { name: string; price: string };
type GalleryImage = { product_id: string; slot: number; url: string };
type OptionsData = { sizes: { product_id: string; name: string; price: number; display_order: number }[]; addons: { id: string; name: string; is_active: boolean }[]; prices: { addon_id: string; size_name: string; price: number }[]; links: { product_id: string; addon_id: string }[] };
const empty: FormValues = { name: '', description: '', price: '' };
const money = (value: number) => '₹' + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const control = 'w-full rounded-xl border border-[#d5d7d0] bg-white px-4 py-3 text-sm text-zinc-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10';
const primary = 'rounded-xl bg-[#1b2822] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [tab,setTab]=useState<'products'|'addons'>('products');
  const [gallery,setGallery]=useState<GalleryImage[]>([]);
  const imagesRef = useRef<ProductImagesHandle>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<FormValues>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [multipleSizes, setMultipleSizes] = useState(false);
  const [sizeRows, setSizeRows] = useState<SizeRow[]>([{name:'Small',price:''},{name:'Medium',price:''},{name:'Large',price:''}]);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [options, setOptions] = useState<OptionsData>({sizes:[],addons:[],prices:[],links:[]});
  const [optionsError, setOptionsError] = useState('');

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

  const refreshOptions = useCallback(async () => {
    const result = await fetchOptions();
    setOptions(result as OptionsData);
  }, []);
  const fetchOptions = async () => {
    if (!adminSupabase) throw new Error('Business connection unavailable');
    const {data:auth}=await adminSupabase.auth.getSession();
    if(!auth.session?.access_token) throw new Error('Sign in again');
    const response=await fetch('/api/business-products?mode=options',{headers:{Authorization:'Bearer '+auth.session.access_token}});
    if(!(response.headers.get('content-type')||'').includes('application/json')) throw new Error('Options unavailable (HTTP '+response.status+')');
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Options unavailable');
    return result;
  };
  const refreshGallery = useCallback(async () => {
    if(!adminSupabase)throw new Error('Business connection unavailable');
    const {data:auth}=await adminSupabase.auth.getSession();
    if(!auth.session?.access_token)throw new Error('Sign in again');
    const response=await fetch('/api/business-products?mode=images',{headers:{Authorization:'Bearer '+auth.session.access_token}});
    if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Photo service unavailable');
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||'Unable to load photos');
    setGallery(body.images||[]);
  },[]);
  useEffect(()=>{void refreshGallery().catch(e=>console.warn('Product photos could not load',e));},[refreshGallery]);
  useEffect(() => {
    void refreshGallery().catch(()=>undefined);
  },[products.length,refreshGallery]);
  useEffect(() => {
    void refreshOptions().catch(e=>setOptionsError(e instanceof Error?e.message:'Options unavailable'));
  }, [refreshOptions]);

  useEffect(() => {
    let active = true;
    void refresh().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load products.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  function startAdd() { setEditingId(null); setForm(empty); setMultipleSizes(false); setSizeRows([{name:'Small',price:''},{name:'Medium',price:''},{name:'Large',price:''}]); setAddonIds([]); setShowForm(true); setError(''); setNotice(''); }
  function startEdit(product: Product) {
    setEditingId(product.id);
    setForm({ name: product.name, description: product.description || '', price: String(product.price) });
    const sizes=options.sizes.filter(s=>s.product_id===product.id).sort((a,b)=>a.display_order-b.display_order);
    setMultipleSizes(sizes.length>0);
    setSizeRows(sizes.length?sizes.map(s=>({name:s.name,price:String(s.price)})):[{name:'Small',price:''},{name:'Medium',price:''},{name:'Large',price:''}]);
    setAddonIds(options.links.filter(l=>l.product_id===product.id).map(l=>l.addon_id));
    setShowForm(true); setError(''); setNotice('');
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setNotice('');
    if(optionsError){setError('Add-on configuration is unavailable. Please refresh before saving.');return;}
    const sizes=multipleSizes?sizeRows.filter(r=>r.name.trim()&&r.price!==''):[];
    if(multipleSizes && (sizes.length !== sizeRows.length || sizes.length<2)){
      setError('Complete at least two sizes and prices, or disable multiple sizes.');return;
    }
    const price=multipleSizes?Number(sizes[0].price):Number(form.price);
    if(!Number.isFinite(price)||price<=0){setError('Enter a valid price.');return;}
    const names=multipleSizes?sizes.map(r=>r.name.trim().toLowerCase()):['standard'];
    if(new Set(names).size!==names.length){setError('Size names must be unique.');return;}
    for(const id of addonIds){
      const prices=options.prices.filter(p=>p.addon_id===id);
      if(names.some(name=>!prices.some(p=>p.size_name.toLowerCase()===name))){
        setError('A selected add-on is missing a price for a configured size. Update the add-on library below.');return;
      }
    }
    setSaving(true);
    try {
      const saved = await request({action:'saveCatalog',...(editingId?{productId:editingId}:{}),
        name:form.name,description:form.description,price,
        sizes:sizes.map(r=>({name:r.name.trim(),price:Number(r.price)})),addonIds});
      const savedId = (saved as {productId?:string}).productId;
      if (!savedId) throw new Error('Product saved but the image upload could not start.');
      try { await imagesRef.current?.uploadQueued(savedId); }
      catch { await refresh(); throw new Error('Product saved, but at least one image could not upload. Edit the product to retry.'); }
      await Promise.all([refresh(),refreshOptions(),refreshGallery()]);
      setShowForm(false);setEditingId(null);setForm(empty);
      setNotice(editingId?'Product and options updated.':'Product and options added.');
    }catch(e){setError(e instanceof Error?e.message:'Could not save product.');}
    finally{setSaving(false);}
  }

  async function setActive(product: Product) {
    if (pendingProductId !== null || saving) return;
    const activating = !product.is_active;
    setPendingProductId(product.id);
    setError('');
    setNotice('');
    try {
      await request({ action: 'setActive', productId: product.id, active: activating });
      // Update the card immediately when the server confirms success,
      // even if the follow-up catalogue refresh is slow.
      setProducts(current => current.map(item =>
        item.id === product.id ? { ...item, is_active: activating } : item
      ));
      setNotice(activating
        ? product.name + ' is active and available in the catalogue.'
        : product.name + ' is archived and unavailable for sale. Existing orders are preserved.');
      try {
        await refresh();
      } catch {
        // The mutation succeeded, so keep the confirmed local state.
        setError('Status saved, but the catalogue could not be refreshed. Reload the page to check.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change product status.');
    } finally {
      setPendingProductId(null);
    }
  }

  return <section className="space-y-6">
    <nav role="tablist" aria-label="Catalogue sections" className="flex gap-2 border-b border-zinc-200 pb-3">
      <button type="button" role="tab" aria-selected={tab==='products'} onClick={()=>setTab('products')} className={'rounded-xl px-4 py-3 text-sm font-semibold '+(tab==='products'?'bg-[#1b2822] text-white':'border bg-white text-zinc-700')}>Product Library</button>
      <button type="button" role="tab" aria-selected={tab==='addons'} onClick={()=>{setTab('addons');setShowForm(false);}} className={'rounded-xl px-4 py-3 text-sm font-semibold '+(tab==='addons'?'bg-[#1b2822] text-white':'border bg-white text-zinc-700')}>Add-On Library</button>
    </nav>
    {tab==='products'&&<div className="flex flex-wrap items-start justify-between gap-4">
      <div><h3 className="text-xl font-semibold">Product Library</h3><p className="mt-2 text-sm text-zinc-500">Manage products, photos, sizes and their available add-ons.</p></div>
      <button type="button" onClick={startAdd} disabled={saving || pendingProductId !== null} className={primary}>+ Add Product</button>
    </div>}
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
    {tab==='products' && showForm && <form onSubmit={e => void save(e)} className="space-y-4 rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center justify-between gap-4"><h4 className="text-lg font-semibold">{editingId ? 'Edit product' : 'Add a product'}</h4><button type="button" className="text-sm text-zinc-600 underline" onClick={() => setShowForm(false)}>Cancel</button></div>
      <label className="block text-sm font-medium">Product name <span className="text-red-700">*</span><input className={control + ' mt-2'} required minLength={2} maxLength={120} placeholder="e.g. Cappuccino" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></label>

      <label className="block text-sm font-medium">Description <span className="font-normal text-zinc-500">(optional)</span><textarea className={control + ' mt-2'} rows={3} maxLength={500} placeholder="What makes it special?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/></label>
      <div className="rounded-xl border border-zinc-200 p-4 space-y-4">
        <label className="flex items-center justify-between gap-3 font-medium">Multiple sizes
          <input type="checkbox" role="switch" checked={multipleSizes} onChange={e=>setMultipleSizes(e.target.checked)} />
        </label>
        {!multipleSizes?<label className="block text-sm font-medium">Price (₹) <input className={control+' mt-2'} type="number" min="0.01" max="100000" step="0.01" required value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} /></label>:
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">Set each available size and its price. No separate base price is required.</p>
          {sizeRows.map((r,i)=><div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input aria-label={'Size '+(i+1)} className={control} maxLength={60} placeholder="Size" required value={r.name} onChange={e=>setSizeRows(v=>v.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
            <input aria-label={'Price for '+r.name} className={control} type="number" min="0.01" max="100000" step="0.01" placeholder="₹" required value={r.price} onChange={e=>setSizeRows(v=>v.map((x,j)=>j===i?{...x,price:e.target.value}:x))}/>
            <button type="button" aria-label="Remove size" className="rounded-lg border px-3" onClick={()=>setSizeRows(v=>v.filter((_,j)=>i!==j))}>×</button>
          </div>)}
          <button type="button" className="rounded-xl border px-4 py-2 text-sm" onClick={()=>setSizeRows(v=>[...v,{name:'',price:''}])}>+ Add size</button>
        </div>}
      </div>
      <div className="rounded-xl border border-zinc-200 p-4 space-y-3">
        <h5 className="font-semibold">Available add-ons</h5>
        <p className="text-sm text-zinc-500">Optional. Select add-ons already configured in the library below.</p>
        {optionsError?<p className="text-sm text-red-600">{optionsError}</p>:options.addons.filter(a=>a.is_active).length===0?<p className="text-sm text-zinc-500">No add-ons created yet.</p>:
        <div className="flex flex-wrap gap-4">{options.addons.filter(a=>a.is_active).map(a=><label key={a.id} className="flex gap-2 text-sm items-center"><input type="checkbox" checked={addonIds.includes(a.id)} onChange={e=>setAddonIds(v=>e.target.checked?[...v,a.id]:v.filter(x=>x!==a.id))}/>{a.name}</label>)}</div>}
      </div>
      <ProductImages key={editingId || 'new'} productId={editingId} apiRef={imagesRef} />
      <button className={primary} disabled={saving || pendingProductId !== null}>{saving ? 'Saving product and photos…' : editingId ? 'Save changes' : 'Save product'}</button>
    </form>}
    {tab==='products' && (loading ? <p className="py-8 text-sm text-zinc-500">Loading products…</p> :
      products.length === 0 ? <div className="rounded-2xl border border-dashed border-[#d5d7d0] bg-white p-8 text-center">
        <h4 className="text-lg font-semibold">Your catalogue is empty</h4>
        <p className="mt-2 text-sm text-zinc-500">Start by adding your first product.</p>
        <button type="button" onClick={startAdd} className={primary + ' mt-5'}>Add your first product</button>
      </div> : <div className="space-y-3">{products.map(p =>
        <article key={p.id} aria-busy={pendingProductId === p.id} className={'flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 shadow-sm transition-colors duration-200 ' + (p.is_active ? 'border-[#e6e3dc] bg-white' : 'border-2 border-dashed border-amber-400 border-l-[6px] border-l-amber-500 bg-amber-50') + (pendingProductId === p.id ? ' ring-2 ring-amber-300' : '')}>
          {gallery.find(image=>image.product_id===p.id && image.slot===1) &&
            <img src={gallery.find(image=>image.product_id===p.id && image.slot===1)?.url} alt={p.name} className="h-24 w-24 shrink-0 rounded-xl object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className={'font-semibold '+(p.is_active?'text-[#1b2822]':'text-zinc-700')}>{p.name}</h4>
              {!p.is_active&&<span className="rounded-full border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-bold uppercase text-amber-950">Archived · Not for sale</span>}
            </div>
            {p.description&&<p className="mt-1 text-sm text-zinc-500">{p.description}</p>}
            {(()=>{
              const sizes=options.sizes.filter(s=>s.product_id===p.id).sort((a,b)=>a.display_order-b.display_order);
              const prices=sizes.map(s=>Number(s.price));
              const min=Math.min(...prices),max=Math.max(...prices);
              const linked=options.links.filter(l=>l.product_id===p.id&&options.addons.some(a=>a.id===l.addon_id&&a.is_active)).length;
              return <div className="mt-2 space-y-1">
                <p className="font-semibold text-[#1b2822]">{sizes.length?(min===max?money(min):money(min)+'–'+money(max)):money(p.price)}</p>
                <p className="text-xs text-zinc-500">{sizes.length?sizes.length+' sizes · '+sizes.map(s=>s.name).join(', '):'Single price'} · {linked} add-on{linked===1?'':'s'} available</p>
              </div>;
            })()}
            {pendingProductId===p.id&&<p role="status" className="mt-2 text-sm font-medium text-amber-900">{p.is_active?'Archiving product…':'Activating product…'}</p>}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={saving || pendingProductId !== null} onClick={() => startEdit(p)} className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50">Edit</button>
            <button type="button" disabled={saving || pendingProductId !== null} onClick={() => void setActive(p)} aria-label={(p.is_active ? 'Archive ' : 'Activate ') + p.name} className={'inline-flex min-w-[118px] items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70 ' + (p.is_active ? 'border-zinc-300 bg-white text-zinc-800' : 'border-emerald-700 bg-emerald-800 text-white')}>
              {pendingProductId === p.id && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              {pendingProductId === p.id ? (p.is_active ? 'Archiving…' : 'Activating…') : (p.is_active ? 'Archive' : 'Activate')}
            </button>
          </div>
        </article>)}</div>)}
    {tab==='addons' && <ProductOptions onChanged={()=>void refreshOptions()} />}
    {tab==='products' && <p className="text-xs text-zinc-500">Archiving preserves order history. Size-specific prices and product photos are configured from Edit.</p>}
  </section>;
}
