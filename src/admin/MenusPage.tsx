import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {adminSupabase} from './client';
type Menu={id:string;name:string;slug:string;sales_mode:'regular'|'event';status:string;location:string|null;event_start_date:string|null;event_end_date:string|null};
type Product={id:string;name:string;price:number;is_active:boolean};
type Size={product_id:string;name:string;price:number;display_order:number};
type Assignment={id:string;event_id:string;product_id:string;display_order:number;price_override:number|null;inventory_tracking:boolean};
type Override={event_product_id:string;size_name:string;price:number};
type Data={menus:Menu[];items:Assignment[];sizes:Size[];overrides:Override[];products:Product[]};
type ItemDraft={product_id:string;track_inventory:boolean;price_override:number|null;size_overrides:Record<string,number>};
const money=(n:number)=>'₹'+n.toLocaleString('en-IN',{maximumFractionDigits:2});
const input='w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm';
const action='rounded-xl bg-[#1b2822] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50';
const blank:Data={menus:[],items:[],sizes:[],overrides:[],products:[]};
export default function MenusPage(){
 const [data,setData]=useState<Data>(blank),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [kind,setKind]=useState<'regular'|'event'>('regular'),[name,setName]=useState(''),[location,setLocation]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
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
 const reload=useCallback(async()=>{setData(await request());},[request]);
 useEffect(()=>{void reload().catch(e=>setError(e instanceof Error?e.message:String(e)));},[reload]);
 const open=(menu:Menu)=>{
  setSelected(menu.id);setError('');setMessage('');
  const rows=data.items.filter(i=>i.event_id===menu.id).sort((a,b)=>a.display_order-b.display_order);
  setDraft(rows.map(i=>({product_id:i.product_id,track_inventory:i.inventory_tracking,price_override:i.price_override,size_overrides:Object.fromEntries(data.overrides.filter(o=>o.event_product_id===i.id).map(o=>[o.size_name,Number(o.price)]))})));
 };
 const selectedMenu=data.menus.find(m=>m.id===selected);
 function update(id:string,fn:(item:ItemDraft)=>ItemDraft){setDraft(v=>v.map(i=>i.product_id===id?fn(i):i));}
 async function create(e:FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');
  try{
   const result=await request({action:'createDraft',kind,name,location,startDate:start||null,endDate:end||null});
   await reload();setShowCreate(false);setMessage('Draft menu created. Add products and save.');
   if(result.menuId){setSelected(result.menuId);setDraft([]);}
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 async function save(){if(!selectedMenu)return;setBusy(true);setError('');setMessage('');
  try{
   await request({action:'saveDraftItems',menuId:selectedMenu.id,items:draft});
   await reload();setMessage('Draft menu saved. Publishing is not enabled in this development slice.');
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 return <section className="space-y-6">
  <div className="flex flex-wrap items-center justify-between gap-4">
   <div><h3 className="text-xl font-semibold">Events & Menus</h3><p className="mt-1 text-sm text-zinc-500">Prepare your everyday menu or create a time-bound event menu. Drafts cannot take orders.</p></div>
   <button type="button" className={action} onClick={()=>{setShowCreate(true);setSelected(null);setError('');}}>+ Create Menu</button>
  </div>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {message&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
  {showCreate&&<form onSubmit={e=>void create(e)} className="space-y-4 rounded-2xl border bg-white p-5">
    <h4 className="font-semibold">New sales menu</h4>
    <div className="flex gap-3">{(['regular','event'] as const).map(v=><label key={v} className="flex items-center gap-2 text-sm"><input type="radio" checked={kind===v} onChange={()=>setKind(v)}/>{v==='regular'?'Regular Sales':'Event Sales'}</label>)}</div>
    <label className="block text-sm font-medium">Menu / event name<input className={input+' mt-2'} value={name} minLength={2} maxLength={120} required onChange={e=>setName(e.target.value)} placeholder={kind==='regular'?'Everyday Menu':'Weekend Coffee Festival'}/></label>
    <label className="block text-sm font-medium">Location (optional)<input className={input+' mt-2'} value={location} onChange={e=>setLocation(e.target.value)}/></label>
    {kind==='event'&&<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Start date<input type="date" className={input+' mt-2'} value={start} onChange={e=>setStart(e.target.value)} required/></label><label className="text-sm font-medium">End date<input type="date" className={input+' mt-2'} min={start} value={end} onChange={e=>setEnd(e.target.value)} required/></label></div>}
    <div className="flex gap-2"><button disabled={busy} className={action}>{busy?'Creating…':'Create Draft'}</button><button type="button" className="rounded-xl border px-4 py-2" onClick={()=>setShowCreate(false)}>Cancel</button></div>
   </form>}
  <div className="grid gap-3 md:grid-cols-2">{data.menus.map(m=><button type="button" key={m.id} onClick={()=>open(m)} className={'rounded-2xl border bg-white p-5 text-left '+(selected===m.id?'border-emerald-700 ring-2 ring-emerald-100':'border-zinc-200')}>
     <div className="flex items-center justify-between"><strong>{m.name}</strong><span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">{m.status}</span></div>
     <p className="mt-2 text-sm text-zinc-500">{m.sales_mode==='regular'?'Regular Sales':'Event'} · {data.items.filter(i=>i.event_id===m.id).length} products</p>
     {m.event_start_date&&<p className="mt-1 text-xs text-zinc-500">{m.event_start_date} to {m.event_end_date}</p>}
    </button>)}</div>
  {!data.menus.length&&!showCreate&&<p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-zinc-500">No new-style menus yet. Existing CRAG and Direct Sales menus are preserved separately.</p>}
  {selectedMenu&&<div className="space-y-4 rounded-2xl border bg-white p-5">
    <div className="flex justify-between gap-3"><div><h4 className="text-lg font-semibold">{selectedMenu.name}</h4><p className="text-sm text-zinc-500">Draft menu editor · {selectedMenu.sales_mode==='regular'?'Product Library prices':'Optional event-specific prices'}</p></div><button type="button" onClick={()=>setSelected(null)} className="text-sm underline">Close</button></div>
    {selectedMenu.status==='draft'?<><p className="text-sm text-zinc-500">Select products for this menu. Each selected product can be tracked individually for inventory. For events, override only the prices that differ from the Product Library.</p>
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
    <button type="button" className={action} disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save Draft Menu'}</button>
    <p className="text-xs text-amber-800">Not published. These menus are not connected to checkout yet.</p>
   </>:<p className="text-sm text-zinc-500">Only draft menus can be edited in this development slice.</p>}
   </div>}
 </section>;
}
