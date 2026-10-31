import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {adminSupabase} from './client';
type Product={id:string;name:string;price:number};
type Size={id:string;product_id:string;name:string;price:number;display_order:number};
type Addon={id:string;name:string;description:string|null;is_active:boolean};
type Price={addon_id:string;size_name:string;price:number};
type Link={product_id:string;addon_id:string};
type Data={sizes:Size[];addons:Addon[];prices:Price[];links:Link[]};
type Row={name:string;price:string};
const input='w-full rounded-xl border border-zinc-300 bg-white p-3 text-zinc-900';
const btn='rounded-xl border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50';
const primary='rounded-xl bg-[#1b2822] px-4 py-3 font-semibold text-white disabled:opacity-50';
const cash=(n:number)=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
const empty:Data={sizes:[],addons:[],prices:[],links:[]};
export default function ProductOptions({products,onChanged}:{products:Product[];onChanged:()=>void}){
 const [data,setData]=useState<Data>(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [mode,setMode]=useState<'none'|'addon'|'sizes'>('none');
 const [productId,setProductId]=useState('');
 const [sizeRows,setSizeRows]=useState<Row[]>([]);
 const [addonId,setAddonId]=useState('');
 const [addonName,setAddonName]=useState(''),[addonDescription,setAddonDescription]=useState('');
 const [addonPrices,setAddonPrices]=useState<Row[]>([{name:'Small',price:''},{name:'Medium',price:''},{name:'Large',price:''}]);
 const request=useCallback(async(payload?:Record<string,unknown>)=>{
  const {data:session}=await adminSupabase!.auth.getSession();
  if(!session.session?.access_token)throw new Error('Session expired. Sign in again.');
  const res=await fetch('/api/business-products?mode=options',{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+session.session.access_token,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
  if(!(res.headers.get('content-type')||'').includes('application/json'))throw new Error('Configuration service unavailable (HTTP '+res.status+')');
  const body=await res.json();
  if(!res.ok)throw new Error(body.error||'Configuration request failed');
  return body;
 },[]);
 const reload=useCallback(async()=>setData(await request() as Data),[request]);
 useEffect(()=>{void reload().catch(e=>setError(String(e)));},[reload]);
 async function act(payload:Record<string,unknown>,message:string){
  setBusy(true);setError('');setNotice('');
  try{await request(payload);await reload();onChanged();setNotice(message);return true;}
  catch(e){setError(e instanceof Error?e.message:'Could not save');return false;}
  finally{setBusy(false);}
 }
 function editSizes(product:Product){
  setProductId(product.id);
  const rows=data.sizes.filter(s=>s.product_id===product.id).sort((a,b)=>a.display_order-b.display_order);
  setSizeRows(rows.length?rows.map(s=>({name:s.name,price:String(s.price)})):[{name:'Small',price:''},{name:'Medium',price:''},{name:'Large',price:''}]);setMode('sizes');setError('');
 }
 function editAddon(addon?:Addon){
  setAddonId(addon?.id||'');setAddonName(addon?.name||'');setAddonDescription(addon?.description||'');
  const prices=addon?data.prices.filter(p=>p.addon_id===addon.id).map(p=>({name:p.size_name,price:String(p.price)})):[{name:'Small',price:''},{name:'Medium',price:''},{name:'Large',price:''}];
  setAddonPrices(prices);setMode('addon');setError('');
 }
 function rowsEditor(rows:Row[],setRows:(v:Row[])=>void){
  return <div className="space-y-2">{rows.map((r,i)=><div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
   <input aria-label={'Size name '+(i+1)} className={input} placeholder="Size name" maxLength={60} value={r.name} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
   <input aria-label={'Price for '+(r.name||'size '+(i+1))} className={input} placeholder="Price ₹" type="number" min="0" max="100000" step=".01" value={r.price} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,price:e.target.value}:x))}/>
   <button type="button" className={btn} aria-label="Remove size" onClick={()=>setRows(rows.filter((_,j)=>i!==j))}>×</button>
  </div>)}
   <button type="button" className={btn} onClick={()=>setRows([...rows,{name:'',price:''}])}>+ Add size</button>
  </div>;
 }
 async function saveSizes(e:FormEvent){
  e.preventDefault();
  const valid=sizeRows.filter(r=>r.name.trim()&&r.price!=='');
  if(valid.length!==sizeRows.length){setError('Complete each size and price, or remove the unused row.');return;}
  if(await act({action:'saveSizes',productId,sizes:valid.map(r=>({name:r.name,price:Number(r.price)}))},'Drink sizes saved.'))setMode('none');
 }
 async function saveAddon(e:FormEvent){
  e.preventDefault();
  const valid=addonPrices.filter(r=>r.name.trim()&&r.price!=='');
  if(!valid.length){setError('Add at least one size-specific price.');return;}
  if(valid.length!==addonPrices.length){setError('Complete every size row or remove the unused row.');return;}
  if(await act({action:'saveAddon',...(addonId?{addonId}:{}),name:addonName,description:addonDescription,prices:valid.map(r=>({size_name:r.name,price:Number(r.price)}))},'Add-on saved.'))setMode('none');
 }
 return <section className="mt-8 space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="text-xl font-semibold">Add-on library</h3><p className="mt-1 text-sm text-zinc-500">Create reusable add-ons and set their price for each drink size.</p></div><button type="button" className={primary} onClick={()=>editAddon()}>+ New Add-On</button></div>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
  {false && mode==='sizes'&&<form className="space-y-4 rounded-2xl border bg-white p-5" onSubmit={e=>void saveSizes(e)}><h4 className="text-lg font-semibold">Sizes for {products.find(p=>p.id===productId)?.name}</h4>
   <p className="text-sm text-zinc-500">A drink can have its own Small, Medium or Large prices. Size names must match those configured on add-ons.</p>
   {rowsEditor(sizeRows,setSizeRows)}
   <div className="flex gap-2"><button className={primary} disabled={busy}>Save sizes</button><button type="button" className={btn} onClick={()=>setMode('none')}>Cancel</button></div>
  </form>}
  {mode==='addon'&&<form className="space-y-4 rounded-2xl border bg-white p-5" onSubmit={e=>void saveAddon(e)}><h4 className="text-lg font-semibold">{addonId?'Edit add-on':'New add-on'}</h4>
   <label className="block text-sm font-medium">Add-on name<input className={input+' mt-2'} required minLength={2} maxLength={120} placeholder="e.g. Almond Milk" value={addonName} onChange={e=>setAddonName(e.target.value)}/></label>
   <label className="block text-sm font-medium">Description (optional)<input className={input+' mt-2'} maxLength={500} value={addonDescription} onChange={e=>setAddonDescription(e.target.value)}/></label>
   <p className="text-sm font-medium">Price by drink size</p>{rowsEditor(addonPrices,setAddonPrices)}
   <div className="flex gap-2"><button className={primary} disabled={busy}>Save add-on</button><button type="button" className={btn} onClick={()=>setMode('none')}>Cancel</button></div>
  </form>}
  <div className="space-y-3">{products.map(p=><div key={p.id} className="rounded-xl border border-zinc-200 bg-white p-4">
   <div className="flex flex-wrap items-center justify-between gap-3"><strong>{p.name}</strong><span className="text-xs text-zinc-500">Edit product to change sizes</span></div>
   <div className="mt-2 text-sm text-zinc-600">{data.sizes.filter(s=>s.product_id===p.id).map(s=>s.name+' '+cash(s.price)).join(' · ')||'Standard price '+cash(p.price)}</div>
   <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Available add-ons for this product</p>
   <div className="mt-2 flex flex-wrap gap-3">{data.addons.filter(a=>a.is_active).map(a=>{
    const checked=data.links.some(l=>l.product_id===p.id&&l.addon_id===a.id);
    return <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={checked} onChange={()=>void act({action:'setProductAddons',productId:p.id,addonIds:checked?data.links.filter(l=>l.product_id===p.id&&l.addon_id!==a.id).map(l=>l.addon_id):[...data.links.filter(l=>l.product_id===p.id).map(l=>l.addon_id),a.id]},'Product add-ons updated.')}/>{a.name}</label>;
   })}</div>
  </div>)}</div>
  <div className="space-y-3"><h4 className="font-semibold">Add-on library</h4>
   {data.addons.map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4"><div><strong>{a.name}</strong>{!a.is_active&&<span className="ml-2 text-xs text-zinc-500">Inactive</span>}<p className="mt-1 text-sm text-zinc-500">{data.prices.filter(x=>x.addon_id===a.id).map(x=>x.size_name+' '+cash(x.price)).join(' · ')||'No prices configured'}</p></div><div className="flex gap-2"><button className={btn} onClick={()=>editAddon(a)}>Edit</button><button className={btn} disabled={busy} onClick={()=>void act({action:'setAddonActive',addonId:a.id,active:!a.is_active},'Add-on status updated.')}>{a.is_active?'Deactivate':'Activate'}</button></div></div>)}
  </div>
  <p className="text-xs text-zinc-500">These settings configure the catalogue. Checkout selection and server-side calculation of add-on totals will be enabled with the ordering workflow; existing checkout continues using its current prices.</p>
 </section>;
}
