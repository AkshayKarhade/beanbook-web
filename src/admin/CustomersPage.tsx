import {useEffect,useState} from 'react';
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
export default function CustomersPage(){
 const [rows,setRows]=useState<Customer[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [now]=useState(()=>new Date());
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
 const filtered=rows.filter(c=>(c.name+' '+c.phone).toLowerCase().includes(query.trim().toLowerCase()));
 return <section className="space-y-5">
  <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 sm:p-6">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><h3 className="text-xl font-semibold">Customer Directory</h3><p className="mt-1 text-sm text-zinc-500">Your business's customers and their order activity.</p></div>
    <span className="rounded-full bg-[#eff5ee] px-3 py-1.5 text-xs font-semibold text-[#355a41]">{rows.length} customers</span>
   </div>
   <label className="mt-5 block"><span className="sr-only">Search customers</span><input type="search" placeholder="Search by name or phone number" value={query} onChange={e=>setQuery(e.target.value)} className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm sm:max-w-md"/></label>
  </div>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
  {loading?<div className="rounded-2xl bg-white p-8 text-center text-zinc-500">Loading customers…</div>:
   <div className="overflow-x-auto rounded-2xl border border-[#e6e3dc] bg-white shadow-sm">
    <table className="w-full min-w-[700px] text-left text-sm">
     <thead className="border-b bg-[#f8f9f6] text-xs uppercase tracking-wider text-zinc-500"><tr><th className="px-5 py-4">Customer</th><th className="px-5 py-4 text-right">LTV (Paid)</th><th className="px-5 py-4 text-right">Order Count</th><th className="px-5 py-4">Latest Order</th></tr></thead>
     <tbody className="divide-y divide-[#eeece8]">{filtered.map(c=><tr key={c.id}>
      <td className="px-5 py-4"><p className="font-semibold text-[#1b2822]">{c.name}</p><p className="mt-1 text-xs text-zinc-500">{c.phone}</p></td>
      <td className="px-5 py-4 text-right font-semibold tabular-nums">{currency.format(c.ltv)}</td>
      <td className="px-5 py-4 text-right tabular-nums">{c.orderCount}</td>
      <td className="px-5 py-4">{c.latestOrderAt?<><span>{dateDisplay.format(new Date(c.latestOrderAt))}</span><span className="ml-1 text-xs text-zinc-500">({daysSince(c.latestOrderAt,now)} days ago)</span></>:<span className="text-zinc-400">No orders yet</span>}</td>
     </tr>)}</tbody>
    </table>
    {!filtered.length&&<p className="p-8 text-center text-sm text-zinc-500">{rows.length?'No customers match your search.':'No customers found for this business yet.'}</p>}
   </div>}
  <p className="text-xs leading-5 text-zinc-500">LTV is the sum of paid order amounts. Order count includes paid and unpaid orders. Days ago is based on India Standard Time (calendar days).</p>
 </section>;
}
