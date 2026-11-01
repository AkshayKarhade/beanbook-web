import {useEffect,useRef,useState,type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import {adminSupabase} from './client';

type Customer={id:string;name:string;phone:string;ltv:number;orderCount:number;latestOrderAt:string|null};
const currency=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2});
const dateDisplay=new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
const dayKey=(date:Date)=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Kolkata'}).format(date);
function daysSince(date:string,now:Date){
 const [y,m,d]=dayKey(new Date(date)).split('-').map(Number);
 const [ty,tm,td]=dayKey(now).split('-').map(Number);
 return Math.max(0,Math.floor((Date.UTC(ty,tm-1,td)-Date.UTC(y,m-1,d))/86400000));
}
export default function CustomersPage({canEdit=false}:{canEdit?:boolean}){
 const [rows,setRows]=useState<Customer[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [selectedId,setSelectedId]=useState<string|null>(null),[editing,setEditing]=useState(false);
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[notice,setNotice]=useState('');
 const [now]=useState(()=>new Date());
 const closeRef=useRef<HTMLButtonElement>(null);
 const selected=rows.find(c=>c.id===selectedId)||null;
 useEffect(()=>{
  const controller=new AbortController();
  async function load(){
   try{
    const {data:auth}=await adminSupabase!.auth.getSession();
    const token=auth.session?.access_token;
    if(!token)throw new Error('Session expired. Sign in again.');
    const res=await fetch('/api/business-products?mode=customers',{headers:{Authorization:'Bearer '+token},signal:controller.signal});
    const result=await res.json();
    if(!res.ok)throw new Error(result.error||'Unable to load customers');
    if(!controller.signal.aborted)setRows(result.customers||[]);
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Unable to load customers');}
   finally{if(!controller.signal.aborted)setLoading(false);}
  }
  void load();
  return()=>controller.abort();
 },[]);
 useEffect(()=>{
  if(!selectedId)return;
  const old=document.body.style.overflow;document.body.style.overflow='hidden';
  closeRef.current?.focus();
  function onKey(e:KeyboardEvent){
   if(e.key==='Escape'&&!saving){e.preventDefault();setSelectedId(null);setEditing(false);}
   if(e.key==='Tab'){
    const root=document.getElementById('customer-details-drawer');
    const focusable=Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')||[]);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  }
  document.addEventListener('keydown',onKey);
  return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',onKey);};
 },[selectedId,saving]);
 function open(c:Customer){setSelectedId(c.id);setName(c.name);setPhone(c.phone);setEditing(false);setSaveError('');setNotice('');}
 function close(){if(saving)return;setSelectedId(null);setEditing(false);}
 async function save(e:FormEvent){
  e.preventDefault();if(!selected||!canEdit||saving)return;
  setSaveError('');setNotice('');
  const cleanName=name.trim(),cleanPhone=phone.replace(/\s/g,'');
  if(cleanName.length<2||cleanName.length>120){setSaveError('Name must be 2–120 characters.');return;}
  if(!/^\+[1-9][0-9]{7,14}$/.test(cleanPhone)){setSaveError('Use an international number, e.g. +919876543210.');return;}
  setSaving(true);
  try{
   const {data:auth}=await adminSupabase!.auth.getSession();
   const token=auth.session?.access_token;if(!token)throw new Error('Session expired. Sign in again.');
   const res=await fetch('/api/business-products?mode=customers',{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id:selected.id,name:cleanName,phone:cleanPhone})});
   const result=await res.json().catch(()=>null);
   if(!res.ok)throw new Error(result?.error||'Unable to save customer details');
   const customer=result.customer as Pick<Customer,'id'|'name'|'phone'>;
   setRows(old=>old.map(c=>c.id===customer.id?{...c,name:customer.name,phone:customer.phone}:c));
   setName(customer.name);setPhone(customer.phone);setEditing(false);setNotice('Customer details updated.');
  }catch(e){setSaveError(e instanceof Error?e.message:'Unable to save details');}
  finally{setSaving(false);}
 }
 const filtered=rows.filter(c=>(c.name+' '+c.phone).toLowerCase().includes(query.trim().toLowerCase()));
 return <section className="space-y-5">
  <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 sm:p-6">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><h3 className="text-xl font-semibold">Customer Directory</h3><p className="mt-1 text-sm text-zinc-500">Select a customer to view their details.</p></div>
    <span className="rounded-full bg-[#eff5ee] px-3 py-1.5 text-xs font-semibold text-[#355a41]">{rows.length} customers</span>
   </div>
   <label className="mt-5 block"><span className="sr-only">Search customers</span><input type="search" placeholder="Search by name or phone number" value={query} onChange={e=>setQuery(e.target.value)} className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm sm:max-w-md"/></label>
  </div>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
  {loading?<div className="rounded-2xl bg-white p-8 text-center text-zinc-500">Loading customers…</div>:
   <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {filtered.map(c=><button key={c.id} type="button" onClick={()=>open(c)} className="rounded-2xl border border-[#e6e3dc] bg-white p-5 text-left shadow-sm transition hover:border-[#70947b] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#355a41]" aria-label={'View '+c.name+' customer details'}>
     <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-base font-semibold text-[#1b2822]">{c.name}</p><p className="mt-1 text-xs text-zinc-500">{c.phone}</p></div><span className="text-xl text-[#5c7661]" aria-hidden="true">↗</span></div>
     <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#eeece8] pt-4"><div><p className="text-xs text-zinc-500">LTV (Paid)</p><p className="mt-1 font-semibold tabular-nums">{currency.format(c.ltv)}</p></div><div><p className="text-xs text-zinc-500">Orders</p><p className="mt-1 font-semibold tabular-nums">{c.orderCount}</p></div></div>
     <p className="mt-4 text-xs text-zinc-500">Latest: {c.latestOrderAt?dateDisplay.format(new Date(c.latestOrderAt))+' ('+daysSince(c.latestOrderAt,now)+' days ago)':'No orders yet'}</p>
    </button>)}
   </div>}
  {!loading&&!filtered.length&&<p className="rounded-2xl bg-white p-8 text-center text-sm text-zinc-500">{rows.length?'No customers match your search.':'No customers found for this business yet.'}</p>}
  <p className="text-xs leading-5 text-zinc-500">LTV includes paid orders only. Order count includes paid and unpaid orders. Days ago uses India Standard Time.</p>
  {selected&&createPortal(<div className="fixed inset-0 z-[110] flex justify-end bg-black/45" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
   <aside id="customer-details-drawer" role="dialog" aria-modal="true" aria-labelledby="customer-drawer-title" className="flex h-full w-full max-w-md flex-col bg-[#faf9f6] text-[#1b2822] shadow-2xl">
    <header className="flex items-center justify-between border-b bg-white px-6 py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-[#688b75]">Customer details</p><h3 id="customer-drawer-title" className="mt-1 text-xl font-semibold">{selected.name}</h3></div><button ref={closeRef} type="button" onClick={close} disabled={saving} className="rounded-lg border px-3 py-2 text-sm" aria-label="Close customer details">✕</button></header>
    <div className="flex-1 space-y-5 overflow-y-auto p-6">
     {notice&&<p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
     {saveError&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
     {editing?<form id="edit-customer-form" onSubmit={e=>void save(e)} className="space-y-4">
      <label className="block text-sm font-medium">Customer name<input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3"/></label>
      <label className="block text-sm font-medium">Phone number<input required type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+919876543210" className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3"/></label>
     </form>:<div className="rounded-2xl bg-white p-5"><p className="text-xs text-zinc-500">Name</p><p className="mt-1 font-semibold">{selected.name}</p><p className="mt-5 text-xs text-zinc-500">Phone</p><p className="mt-1 font-semibold">{selected.phone}</p></div>}
     <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-white p-4"><p className="text-xs text-zinc-500">Lifetime paid value</p><p className="mt-2 text-lg font-semibold tabular-nums">{currency.format(selected.ltv)}</p></div><div className="rounded-2xl bg-white p-4"><p className="text-xs text-zinc-500">Total orders</p><p className="mt-2 text-lg font-semibold tabular-nums">{selected.orderCount}</p></div></div>
     <div className="rounded-2xl bg-white p-4"><p className="text-xs text-zinc-500">Latest order</p><p className="mt-2 font-semibold">{selected.latestOrderAt?dateDisplay.format(new Date(selected.latestOrderAt))+' ('+daysSince(selected.latestOrderAt,now)+' days ago)':'No orders yet'}</p></div>
     {!canEdit&&<p className="text-xs leading-5 text-zinc-500">Only the Business Admin can edit customer details.</p>}
    </div>
    {canEdit&&<footer className="flex gap-3 border-t bg-white p-5">{editing?<><button type="button" disabled={saving} onClick={()=>{setEditing(false);setSaveError('');setName(selected.name);setPhone(selected.phone);}} className="flex-1 rounded-xl border px-4 py-3 font-semibold">Cancel</button><button type="submit" form="edit-customer-form" disabled={saving} className="flex-1 rounded-xl bg-[#1b2822] px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?'Saving…':'Save changes'}</button></>:<button type="button" onClick={()=>{setEditing(true);setNotice('');}} className="w-full rounded-xl bg-[#1b2822] px-4 py-3 font-semibold text-white">Edit details</button>}</footer>}
   </aside>
  </div>,document.body)}
 </section>;
}
