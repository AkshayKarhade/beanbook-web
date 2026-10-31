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
 const [data,setData]=useState<Data>(empty),[busy,setBusy]=useState(false),[pendingAddonId,setPendingAddonId]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [mode,setMode]=useState<'none'|'addon'|'sizes'>('none');
 const [addonId,setAddonId]=useState('');
 const [addonName,setAddonName]=useState(''),[addonDescription,setAddonDescription]=useState('');
 const [standardPrice,setStandardPrice]=useState('');
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
 async function toggleAddon(addon:Addon){
  if(busy||pendingAddonId!==null)return;
  const activating=!addon.is_active;
  setPendingAddonId(addon.id);
  setError('');setNotice('');
  try{
   await request({action:'setAddonActive',addonId:addon.id,active:activating});
   // The server has confirmed success: reflect it immediately while refreshing.
   setData(current=>({...current,addons:current.addons.map(item=>
    item.id===addon.id?{...item,is_active:activating}:item)}));
   setNotice(activating
    ?addon.name+' is active and available as an add-on.'
    :addon.name+' has been deactivated and is no longer selectable. Existing orders are preserved.');
   try{
    await reload();
    onChanged();
   }catch{
    // Do not revert a successfully updated status if refreshing fails.
    setError('Add-on status saved, but the list could not be refreshed. Reload to verify.');
   }
  }catch(e){
   setError(e instanceof Error?e.message:'Could not change add-on status.');
  }finally{setPendingAddonId(null);}
 }
 function editAddon(addon?:Addon){
  setAddonId(addon?.id||'');setAddonName(addon?.name||'');setAddonDescription(addon?.description||'');
  const existing=addon?data.prices.filter(p=>p.addon_id===addon.id):[];
  setStandardPrice(existing.find(p=>p.size_name.toLowerCase()==='standard')?.price.toString()??'');
  const sizePrices=existing.filter(p=>p.size_name.toLowerCase()!=='standard');
  const prices=sizePrices.length?sizePrices.map(p=>({name:p.size_name,price:String(p.price)})):[{name:'Small',price:''},{name:'Medium',price:''},{name:'Large',price:''}];
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
 async function saveAddon(e:FormEvent){
  e.preventDefault();
  const incomplete=addonPrices.some(r=>r.price!==''&&!r.name.trim());
  if(incomplete){setError('Give every priced size a name.');return;}
  const sizePrices=addonPrices.filter(r=>r.name.trim()&&r.price!=='').map(r=>({size_name:r.name.trim(),price:Number(r.price)}));
  const standard=standardPrice.trim();
  if(!sizePrices.length&&!standard){setError('Enter a Standard price or at least one size-specific price.');return;}
  if(standard&&(!Number.isFinite(Number(standard))||Number(standard)<0||Number(standard)>100000)){
   setError('Enter a valid Standard price.');return;
  }
  const prices=[...(standard!==''?[{size_name:'Standard',price:Number(standard)}]:[]),...sizePrices];
  if(await act({action:'saveAddon',...(addonId?{addonId}:{}),name:addonName,description:addonDescription,prices},'Add-on saved.'))setMode('none');
 }
 return <section className="mt-8 space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="text-xl font-semibold">Add-on library</h3><p className="mt-1 text-sm text-zinc-500">Create reusable add-ons and set their price for each drink size.</p></div><button type="button" className={primary} disabled={busy||pendingAddonId!==null} onClick={()=>editAddon()}>+ New Add-On</button></div>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
  {mode==='addon'&&<form className="space-y-4 rounded-2xl border bg-white p-5" onSubmit={e=>void saveAddon(e)}><h4 className="text-lg font-semibold">{addonId?'Edit add-on':'New add-on'}</h4>
   <label className="block text-sm font-medium">Add-on name<input className={input+' mt-2'} required minLength={2} maxLength={120} placeholder="e.g. Almond Milk" value={addonName} onChange={e=>setAddonName(e.target.value)}/></label>
   <label className="block text-sm font-medium">Description (optional)<input className={input+' mt-2'} maxLength={500} value={addonDescription} onChange={e=>setAddonDescription(e.target.value)}/></label>
   <label className="block text-sm font-medium">Standard price (₹) <span className="font-normal text-zinc-500">(optional)</span>
    <input aria-label="Standard add-on price" className={input+' mt-2'} type="number" min="0" max="100000" step="0.01" inputMode="decimal" placeholder="e.g. 50" value={standardPrice} onChange={e=>setStandardPrice(e.target.value)}/>
    <span className="mt-1 block text-xs font-normal text-zinc-500">Used when a drink has one fixed price and no Small, Medium or Large size.</span>
   </label>
   <p className="text-sm font-medium">Prices by drink size <span className="font-normal text-zinc-500">(optional)</span></p>
   <p className="text-xs text-zinc-500">Leave unused size prices blank. You can configure Standard and multiple size prices together.</p>
   {rowsEditor(addonPrices,setAddonPrices)}
   <div className="flex gap-2"><button className={primary} disabled={busy||pendingAddonId!==null}>Save add-on</button><button type="button" className={btn} disabled={busy||pendingAddonId!==null} onClick={()=>setMode('none')}>Cancel</button></div>
  </form>}
  <div className="space-y-3">{products.map(p=><div key={p.id} className="rounded-xl border border-zinc-200 bg-white p-4">
   <div className="flex flex-wrap items-center justify-between gap-3"><strong>{p.name}</strong><span className="text-xs text-zinc-500">Edit product to change sizes</span></div>
   <div className="mt-2 text-sm text-zinc-600">{data.sizes.filter(s=>s.product_id===p.id).map(s=>s.name+' '+cash(s.price)).join(' · ')||'Standard price '+cash(p.price)}</div>
   <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Available add-ons for this product</p>
   <div className="mt-2 flex flex-wrap gap-3">{data.addons.filter(a=>a.is_active).map(a=>{
    const checked=data.links.some(l=>l.product_id===p.id&&l.addon_id===a.id);
    return <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy||pendingAddonId!==null} checked={checked} onChange={()=>void act({action:'setProductAddons',productId:p.id,addonIds:checked?data.links.filter(l=>l.product_id===p.id&&l.addon_id!==a.id).map(l=>l.addon_id):[...data.links.filter(l=>l.product_id===p.id).map(l=>l.addon_id),a.id]},'Product add-ons updated.')}/>{a.name}</label>;
   })}</div>
  </div>)}</div>
  <div className="space-y-3"><h4 className="font-semibold">Add-on library</h4>
   {data.addons.map(a=>
    <article key={a.id} aria-busy={pendingAddonId===a.id} className={'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-sm transition-colors duration-200 '+(a.is_active?'border-zinc-200 bg-white':'border-2 border-dashed border-amber-400 border-l-[6px] border-l-amber-500 bg-amber-50')+(pendingAddonId===a.id?' ring-2 ring-amber-300':'')}>
     <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
       <strong className={a.is_active?'text-[#1b2822]':'text-zinc-700'}>{a.name}</strong>
       {!a.is_active&&<span className="rounded-full border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-950">Inactive · Not available</span>}
      </div>
      <p className={'mt-1 text-sm '+(a.is_active?'text-zinc-500':'text-zinc-600')}>{data.prices.filter(x=>x.addon_id===a.id).map(x=>x.size_name+' '+cash(x.price)).join(' · ')||'No prices configured'}</p>
      {pendingAddonId===a.id&&<p role="status" className="mt-2 text-sm font-medium text-amber-900">{a.is_active?'Deactivating add-on…':'Activating add-on…'}</p>}
     </div>
     <div className="flex gap-2">
      <button type="button" className={btn} disabled={busy||pendingAddonId!==null} onClick={()=>editAddon(a)}>Edit</button>
      <button type="button" aria-label={(a.is_active?'Deactivate ':'Activate ')+a.name} className={'inline-flex min-w-[132px] items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70 '+(a.is_active?'border-zinc-300 bg-white text-zinc-800':'border-emerald-700 bg-emerald-800 text-white')} disabled={busy||pendingAddonId!==null} onClick={()=>void toggleAddon(a)}>
       {pendingAddonId===a.id&&<span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"/>}
       {pendingAddonId===a.id?(a.is_active?'Deactivating…':'Activating…'):(a.is_active?'Deactivate':'Activate')}
      </button>
     </div>
    </article>)}
  </div>
  <p className="text-xs text-zinc-500">These settings configure the catalogue. Checkout selection and server-side calculation of add-on totals will be enabled with the ordering workflow; existing checkout continues using its current prices.</p>
 </section>;
}
