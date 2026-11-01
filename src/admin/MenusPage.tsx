import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {adminSupabase} from './client';
import {QRCodeCanvas} from 'qrcode.react';
import CounterPOS from './CounterPOS';
import {downloadMenuQrCard,menuPublicUrl,isMenuPreview} from './menuQrCard';
type Menu={id:string;name:string;slug:string;sales_mode:'regular'|'event';status:string;location:string|null;event_start_date:string|null;event_end_date:string|null};
type Product={id:string;name:string;price:number;is_active:boolean};
type Size={product_id:string;name:string;price:number;display_order:number};
type Assignment={id:string;event_id:string;product_id:string;display_order:number;price_override:number|null;inventory_tracking:boolean};
type Override={event_product_id:string;size_name:string;price:number};
type Data={paymentSettings:{upi_vpa:string;payee_name:string}|null;businessName:string;menus:Menu[];items:Assignment[];sizes:Size[];overrides:Override[];products:Product[]};
type ItemDraft={product_id:string;track_inventory:boolean;price_override:number|null;size_overrides:Record<string,number>};
const money=(n:number)=>'₹'+n.toLocaleString('en-IN',{maximumFractionDigits:2});
const input='w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm';
const action='rounded-xl bg-[#1b2822] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50';
const blank:Data={paymentSettings:null,businessName:'',menus:[],items:[],sizes:[],overrides:[],products:[]};
export default function MenusPage({onReturnToLiveOrders}:{onReturnToLiveOrders:()=>void}){
 const [data,setData]=useState<Data>(blank),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [kind,setKind]=useState<'regular'|'event'>('regular'),[name,setName]=useState(''),[location,setLocation]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const qrRef=useRef<HTMLDivElement>(null);
 const [downloading,setDownloading]=useState(false);
 const [tab,setTab]=useState<'regular'|'event'>('regular');
 const [activated,setActivated]=useState<string|null>(null);
 const [posMenuId,setPosMenuId]=useState<string|null>(null);
 const [selected,setSelected]=useState<string|null>(null),[draft,setDraft]=useState<ItemDraft[]>([]),[showCreate,setShowCreate]=useState(false);
 const request=useCallback(async(payload?:Record<string,unknown>):Promise<Data&{menuId?:string;ok?:boolean}>=>{
  if(!adminSupabase)throw new Error('Business connection unavailable');
  const {data:auth}=await adminSupabase.auth.getSession();
  if(!auth.session?.access_token)throw new Error('Your session expired. Sign in again.');
  const res=await fetch('/api/business-products?mode=menus',{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+auth.session.access_token,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
  if(!(res.headers.get('content-type')||'').includes('application/json'))throw new Error('Menu service unavailable (HTTP '+res.status+')');
  const body=await res.json();if(!res.ok)throw new Error(body.error||'Could not manage menu');
  return body;
 },[]);
 const reload=useCallback(async()=>{const d=await request();setData(d);},[request]);
 useEffect(()=>{void reload().catch(e=>setError(e instanceof Error?e.message:String(e)));},[reload]);
 const open=(menu:Menu)=>{
  setSelected(menu.id);setError('');setMessage('');
  const rows=data.items.filter(i=>i.event_id===menu.id).sort((a,b)=>a.display_order-b.display_order);
  setDraft(rows.map(i=>({product_id:i.product_id,track_inventory:i.inventory_tracking,price_override:i.price_override,size_overrides:Object.fromEntries(data.overrides.filter(o=>o.event_product_id===i.id).map(o=>[o.size_name,Number(o.price)]))})));
 };
 const selectedMenu=data.menus.find(m=>m.id===selected);
 const activatedMenu=data.menus.find(m=>m.id===activated);
 const menuUrl=menuPublicUrl;
 async function downloadCard(){
  if(!activatedMenu)return;
  const canvas=qrRef.current?.querySelector('canvas');
  if(!canvas){setError('QR code is not ready. Try again.');return;}
  setDownloading(true);setError('');
  try{await downloadMenuQrCard({businessName:data.businessName,menuName:activatedMenu.name,menuType:activatedMenu.sales_mode,location:activatedMenu.location,url:menuUrl(activatedMenu.id),preview:isMenuPreview()},canvas);}
  catch(e){setError(e instanceof Error?e.message:'Could not download QR card');}
  finally{setDownloading(false);}
 }
 function update(id:string,fn:(item:ItemDraft)=>ItemDraft){setDraft(v=>v.map(i=>i.product_id===id?fn(i):i));}
 async function create(e:FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');
  try{
   const result=await request({action:'createDraft',kind,name,location,startDate:start||null,endDate:end||null});
   await reload();setShowCreate(false);setMessage('Draft menu created. Add products and save.');setTab(kind);
   if(result.menuId){setSelected(result.menuId);setDraft([]);}
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 async function save(){if(!selectedMenu)return;setBusy(true);setError('');setMessage('');
  try{
   await request({action:'saveDraftItems',menuId:selectedMenu.id,items:draft});
   await reload();setMessage(selectedMenu.status==='published'?'Published menu updated; existing URL and QR remain valid.':'Draft menu saved. Review products and publish to activate its public URL and QR code.');
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 async function deleteMenu(menu:Menu){
  if(!window.confirm('Remove "'+menu.name+'"? Its QR link will stop working. Previous orders remain in history.'))return;
  setBusy(true);setError('');setMessage('');
  try{await request({action:'deleteMenu',menuId:menu.id});setSelected(null);setActivated(null);setPosMenuId(null);await reload();setMessage(menu.name+' removed. Previous orders are preserved.');}
  catch(e){setError(e instanceof Error?e.message:'Could not remove menu');}
  finally{setBusy(false);}
 }
 async function publish(){
  if(!selectedMenu||selectedMenu.status!=='draft')return;
  setBusy(true);setError('');setMessage('');
  try{
   await request({action:'publishMenu',menuId:selectedMenu.id});
   await reload();setActivated(selectedMenu.id);setSelected(null);
   setMessage('Menu published. Your unique URL and QR code are ready.');
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 return <section className="space-y-6">
  <nav className="flex gap-2 border-b border-zinc-200 pb-3" role="tablist" aria-label="Menu libraries">
   <button type="button" role="tab" aria-selected={tab==='regular'} onClick={()=>{setTab('regular');setSelected(null);setActivated(null);setShowCreate(false);}} className={'rounded-xl px-4 py-3 text-sm font-semibold '+(tab==='regular'?'bg-[#1b2822] text-white':'border bg-white text-zinc-700')}>Regular Menus</button>
   <button type="button" role="tab" aria-selected={tab==='event'} onClick={()=>{setTab('event');setSelected(null);setActivated(null);setShowCreate(false);}} className={'rounded-xl px-4 py-3 text-sm font-semibold '+(tab==='event'?'bg-[#1b2822] text-white':'border bg-white text-zinc-700')}>Event Menus</button>
  </nav>
  <div className="flex flex-wrap items-center justify-between gap-4">
   <div><h3 className="text-xl font-semibold">{tab==='regular'?'Regular Menus':'Event Menus'}</h3><p className="mt-1 text-sm text-zinc-500">{tab==='regular'?'Create a separate menu for each café, cart or sales location.':'Manage several event menus at once, each with its own products, dates and QR code.'}</p></div>
   <button type="button" className={action} onClick={()=>{setKind(tab);setName('');setLocation('');setStart('');setEnd('');setShowCreate(true);setSelected(null);setActivated(null);setError('');}}>+ Create {tab==='regular'?'Regular Menu':'Event Menu'}</button>
  </div>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {message&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
  {showCreate&&<form onSubmit={e=>void create(e)} className="space-y-4 rounded-2xl border bg-white p-5">
    <h4 className="font-semibold">New sales menu</h4>
    <label className="block text-sm font-medium">Menu / event name<input className={input+' mt-2'} value={name} minLength={2} maxLength={120} required onChange={e=>setName(e.target.value)} placeholder={kind==='regular'?'Everyday Menu':'Weekend Coffee Festival'}/></label>
    <label className="block text-sm font-medium">Location (optional)<input className={input+' mt-2'} value={location} onChange={e=>setLocation(e.target.value)}/></label>
    {kind==='event'&&<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Start date<input type="date" className={input+' mt-2'} value={start} onChange={e=>setStart(e.target.value)} required/></label><label className="text-sm font-medium">End date<input type="date" className={input+' mt-2'} min={start} value={end} onChange={e=>setEnd(e.target.value)} required/></label></div>}
    <div className="flex gap-2"><button disabled={busy} className={action}>{busy?'Creating…':'Create Draft'}</button><button type="button" className="rounded-xl border px-4 py-2" onClick={()=>setShowCreate(false)}>Cancel</button></div>
   </form>}
  <div className="grid gap-4 md:grid-cols-2">
    {data.menus.filter(m=>m.sales_mode===tab).map(m=><article key={m.id} className={'flex flex-col justify-between gap-4 rounded-2xl border bg-white p-5 shadow-sm '+(selected===m.id||activated===m.id||posMenuId===m.id?'border-emerald-600 ring-2 ring-emerald-100':'border-zinc-200')}>
     <div>
      <div className="flex items-start justify-between gap-3">
       <h4 className="font-semibold text-[#1b2822]">{m.name}</h4>
       <span className={'shrink-0 rounded-full px-3 py-1 text-xs font-medium '+(m.status==='published'?'bg-emerald-100 text-emerald-900':'bg-amber-100 text-amber-900')}>{m.status==='published'?'Published':'Draft'}</span>
      </div>
      <p className="mt-2 text-sm text-zinc-500">{m.sales_mode==='regular'?'Regular Sales':'Event'} · {data.items.filter(i=>i.event_id===m.id).length} product{data.items.filter(i=>i.event_id===m.id).length===1?'':'s'}</p>
      {m.event_start_date&&<p className="mt-1 text-xs text-zinc-500">{m.event_start_date} to {m.event_end_date}</p>}
      {m.location&&<p className="mt-1 text-xs text-zinc-500">{m.location}</p>}
     </div>
     <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
      {m.status==='draft'?<button type="button" disabled={busy} className="rounded-xl bg-[#1b2822] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={()=>{setPosMenuId(null);setActivated(null);open(m);}}>Edit Draft</button>:<>
       <button type="button" className="rounded-xl border px-4 py-2 text-sm" onClick={()=>{setPosMenuId(null);setActivated(null);open(m);}}>Edit Menu</button>
       <button type="button" className="rounded-xl bg-[#1b2822] px-4 py-2 text-sm font-semibold text-white" onClick={()=>{setPosMenuId(m.id);setActivated(null);setSelected(null);}}>Open Counter POS</button>
       <button type="button" className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium" onClick={()=>{setPosMenuId(null);setActivated(m.id);setSelected(null);}}>View QR & Link</button>
      </>}
      <button type="button" disabled={busy} aria-label={'Delete '+m.name} className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800 disabled:opacity-50" onClick={()=>void deleteMenu(m)}>Delete</button>
     </div>
    </article>)}
  </div>
  {!data.menus.some(m=>m.sales_mode===tab)&&!showCreate&&<p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-zinc-500">No menus in this section yet. Create a menu for a location or event; existing CRAG and Direct Sales flows are unchanged.</p>}
  {selectedMenu&&<div className="space-y-4 rounded-2xl border bg-white p-5">
    <div className="flex justify-between gap-3"><div><h4 className="text-lg font-semibold">{selectedMenu.name}</h4><p className="text-sm text-zinc-500">Draft menu editor · {selectedMenu.sales_mode==='regular'?'Product Library prices':'Optional event-specific prices'}</p></div><button type="button" onClick={()=>setSelected(null)} className="text-sm underline">Close</button></div>
    {['draft','published'].includes(selectedMenu.status)?<><p className="text-sm text-zinc-500">Select products for this menu. Each selected product can be tracked individually for inventory. For events, override only the prices that differ from the Product Library.</p>
    <div className="space-y-3">{data.products.filter(p=>p.is_active).map(p=>{
      const item=draft.find(i=>i.product_id===p.id);
      const sizes=data.sizes.filter(s=>s.product_id===p.id).sort((a,b)=>a.display_order-b.display_order);
      return <div key={p.id} className="rounded-xl border p-4">
       <label className="flex items-center gap-3 font-medium"><input type="checkbox" checked={!!item} onChange={e=>setDraft(v=>e.target.checked?[...v,{product_id:p.id,track_inventory:false,price_override:null,size_overrides:{}}]:v.filter(x=>x.product_id!==p.id))}/>{p.name}</label>
       <p className="ml-7 mt-1 text-xs text-zinc-500">{sizes.length?sizes.map(s=>s.name+' '+money(Number(s.price))).join(' · '):'Regular price '+money(Number(p.price))}</p>
       {item&&<div className="ml-7 mt-3 space-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.track_inventory} onChange={e=>update(p.id,x=>({...x,track_inventory:e.target.checked}))}/>Track inventory for this menu item</label>
        {selectedMenu.sales_mode==='event'&&<div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-600">Optional event prices — leave blank to inherit defaults</p>
          {sizes.length?sizes.map(s=><label key={s.name} className="flex max-w-xs items-center gap-3 text-sm"><span className="w-24">{s.name}</span><input className={input} type="number" min="0.01" max="100000" step="0.01" placeholder={String(s.price)} value={item.size_overrides[s.name]??''} onChange={e=>update(p.id,x=>{const next={...x.size_overrides};if(!e.target.value)delete next[s.name];else next[s.name]=Number(e.target.value);return {...x,size_overrides:next};})}/></label>):
           <label className="flex max-w-xs items-center gap-3 text-sm"><span className="w-24">Event price</span><input className={input} type="number" min="0.01" max="100000" step="0.01" placeholder={String(p.price)} value={item.price_override??''} onChange={e=>update(p.id,x=>({...x,price_override:e.target.value?Number(e.target.value):null}))}/></label>}
         </div>}
       </div>}
      </div>;
    })}</div>
    <button type="button" className={action} disabled={busy} onClick={()=>void save()}>{busy?'Saving…':selectedMenu.status==='published'?'Save Published Menu':'Save Draft Menu'}</button>
    {selectedMenu.status==='draft'&&<button type="button" className="rounded-xl border border-emerald-800 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 disabled:opacity-50" disabled={busy||!draft.length} onClick={()=>void publish()}>Publish & Generate QR</button>}
    <p className="text-xs text-amber-800">{selectedMenu.status==='published'?'Changes take effect immediately. Existing paid orders retain their charged prices.':'Save changes before publishing.'}</p>
   </>:<p className="text-sm text-zinc-500">Menu cannot be edited in its current state.</p>}
   </div>}
  {posMenuId&&<CounterPOS key={posMenuId} businessName={data.businessName} menuId={posMenuId} menuName={data.menus.find(m=>m.id===posMenuId)?.name||'Menu'} paymentSettings={data.paymentSettings} trackedIds={data.items.filter(i=>i.event_id===posMenuId&&i.inventory_tracking).map(i=>i.product_id)} onClose={()=>setPosMenuId(null)} onSaveUnpaid={onReturnToLiveOrders}/>}
  {activatedMenu&&<section className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-6" role="status">
    <div className="text-3xl" aria-hidden="true">✓</div><h3 className="text-xl font-semibold text-emerald-800">Menu activated successfully!</h3>
    <p className="text-sm text-zinc-600">{activatedMenu.name} now has its own public link and QR code. You can print this QR for your customers.</p>
    <div className="mx-auto max-w-sm rounded-2xl border border-zinc-200 bg-[#f5f3ef] p-4 text-center shadow-sm">
      <div className="space-y-3 rounded-xl bg-white px-5 py-7">
       {isMenuPreview()&&<p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900">TEST ONLY · PREVIEW QR</p>}
       <h4 className="text-xl font-bold text-[#1b2822]">{data.businessName}</h4>
       <p className="text-lg font-semibold text-[#334139]">{activatedMenu.name}</p>
       <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{activatedMenu.sales_mode==='regular'?'Regular Menu':'Event Menu'}</p>
       <div ref={qrRef} className="flex justify-center rounded-xl border border-zinc-100 bg-white p-4">
        <QRCodeCanvas value={menuUrl(activatedMenu.id)} size={512} level="M" marginSize={4} bgColor="#ffffff" fgColor="#111111" style={{width:240,height:240,maxWidth:'100%'}}/>
       </div>
       <p className="font-bold uppercase tracking-wide text-[#1b2822]">Scan to View Menu</p>
       {activatedMenu.location&&<p className="text-xs text-zinc-500">{activatedMenu.location}</p>}
      </div>
     </div>
    <p className="break-all rounded-xl bg-zinc-50 p-3 text-sm">{menuUrl(activatedMenu.id)}</p>
    {isMenuPreview()&&<p className="text-sm font-medium text-amber-800">This QR opens the temporary development preview. Do not print or share it with customers. After the production release, download a new permanent QR card.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={action} disabled={downloading} onClick={()=>void downloadCard()}>{downloading?'Preparing PNG…':'Download QR Card (PNG)'}</button><button type="button" className="rounded-xl border px-4 py-3 text-sm font-semibold" onClick={()=>void navigator.clipboard.writeText(menuUrl(activatedMenu.id))}>Copy URL</button><a className="rounded-xl border px-4 py-3 text-sm font-semibold" href={menuUrl(activatedMenu.id)} target="_blank" rel="noreferrer">View Menu</a><button type="button" className="rounded-xl border px-4 py-3 text-sm" onClick={()=>setActivated(null)}>Back to Library</button></div>
    <p className="text-xs text-amber-800">The menu is published for viewing only. Payment and ordering will be enabled after their tests.</p>
  </section>}
 </section>;
}
