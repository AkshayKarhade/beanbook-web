import {useEffect,useState,type FormEvent} from 'react';
import {adminSupabase} from './client';
import {QRCodeCanvas} from 'qrcode.react';
type Product={id:string;name:string;description:string|null;price:number|null;sizes:{name:string;price:number}[];images:string[]};
type Addon={id:string;name:string;is_active:boolean};
type Price={addon_id:string;size_name:string;price:number};
type Link={product_id:string;addon_id:string};
type Line={product_id:string;size_name:string;quantity:number;addon_ids:string[];key:string};
type MenuData={products:Product[]};
const money=(n:number)=>'₹'+n.toLocaleString('en-IN',{maximumFractionDigits:2});
const input='w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm';
export default function CounterPOS({menuId,menuName,trackedIds,paymentSettings,onClose}:{menuId:string;menuName:string;trackedIds:string[];paymentSettings:{upi_vpa:string;payee_name:string}|null;onClose:()=>void}){
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[started,setStarted]=useState(false);
 const [menu,setMenu]=useState<MenuData|null>(null),[addons,setAddons]=useState<Addon[]>([]),[prices,setPrices]=useState<Price[]>([]),[links,setLinks]=useState<Link[]>([]);
 const [lines,setLines]=useState<Line[]>([]),[error,setError]=useState(''),[orderNumber,setOrderNumber]=useState(''),[busy,setBusy]=useState(false);
 const [amount,setAmount]=useState<number|null>(null),[paymentMethod,setPaymentMethod]=useState<'upi'|'cash'>('upi'),[reference,setReference]=useState(''),[paid,setPaid]=useState(false);
 const [choices,setChoices]=useState<Record<string,{size:string;addons:string[]}>>({});
 useEffect(()=>{const controller=new AbortController();let live=true;async function load(){
  try{
   const [res,auth]=await Promise.all([fetch('/api/business-products?mode=public-menu&id='+encodeURIComponent(menuId),{signal:controller.signal}),adminSupabase?.auth.getSession()]);
   if(!res.ok)throw new Error('Menu unavailable');
   const data=await res.json() as MenuData;
   if(!auth?.data.session?.access_token)throw new Error('Please sign in again');
   const opt=await fetch('/api/business-products?mode=options',{signal:controller.signal,headers:{Authorization:'Bearer '+auth.data.session.access_token}});
   if(!opt.ok)throw new Error('Could not load add-on configuration');
   const o=await opt.json();
   if(live){setMenu(data);setAddons(o.addons||[]);setPrices(o.prices||[]);setLinks(o.links||[]);}
  }catch(e){if(live)setError(e instanceof Error?e.message:'Menu unavailable');}
 }void load();return()=>{live=false;controller.abort();};},[menuId]);
 function begin(e:FormEvent){e.preventDefault();if(name.trim().length<2||!/^\+[1-9][0-9]{7,14}$/.test(phone)){setError('Enter a name and international phone, e.g. +919876543210');return;}setError('');setStarted(true);}
 function add(p:Product){if(trackedIds.includes(p.id)){setError('Inventory-tracked products cannot be ordered until reservations are ready.');return;}
 const selected=choices[p.id];const size=p.sizes.length?selected?.size||p.sizes[0].name:'';
 const addIds=selected?.addons||[];
 const key=p.id+'|'+size+'|'+[...addIds].sort().join(',');
 setLines(old=>old.some(l=>l.key===key)?old.map(l=>l.key===key?{...l,quantity:Math.min(20,l.quantity+1)}:l):[...old,{key,product_id:p.id,size_name:size,quantity:1,addon_ids:addIds}]);setError('');}
 function lineTotal(l:Line){const p=menu?.products.find(x=>x.id===l.product_id);if(!p)return 0;const base=p.sizes.length?p.sizes.find(s=>s.name===l.size_name)?.price||0:Number(p.price||0);return l.quantity*(base+l.addon_ids.reduce((total,id)=>total+(prices.find(x=>x.addon_id===id&&x.size_name.toLowerCase()===(l.size_name||'standard').toLowerCase())?.price||0),0));}
 async function submit(){if(!lines.length)return;setBusy(true);setError('');
 try{
  const auth=await adminSupabase?.auth.getSession();const token=auth?.data.session?.access_token;if(!token)throw new Error('Sign in again');
  const res=await fetch('/api/business-products?mode=menus',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'createCounterOrder',menuId,customerName:name.trim(),customerPhone:phone,items:lines.map(l=>({product_id:l.product_id,size_name:l.size_name,quantity:l.quantity,addon_ids:l.addon_ids}))})});
  const body=await res.json();if(!res.ok)throw new Error(body.error||'Order failed');setOrderNumber(body.orderNumber);setAmount(Number(body.amount));setLines([]);
 }catch(e){setError(e instanceof Error?e.message:'Could not create order');}finally{setBusy(false);}
 }
 const upiUri=paymentSettings&&amount!==null&&amount>0?'upi://pay?'+new URLSearchParams({pa:paymentSettings.upi_vpa,pn:paymentSettings.payee_name,am:amount.toFixed(2),cu:'INR',tn:'BeanBook '+orderNumber}).toString():null;
 async function confirmPayment(){
  if(!window.confirm('Have you verified receipt of '+money(amount||0)+' in the business account or cash drawer?'))return;
  setBusy(true);setError('');
  try{
   const auth=await adminSupabase?.auth.getSession();const token=auth?.data.session?.access_token;if(!token)throw new Error('Sign in again');
   const res=await fetch('/api/business-products?mode=menus',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'confirmCounterPayment',orderNumber,paymentMethod,transactionReference:reference})});
   const body=await res.json();if(!res.ok)throw new Error(body.error||'Could not confirm payment');setPaid(true);
  }catch(e){setError(e instanceof Error?e.message:'Could not confirm payment');}finally{setBusy(false);}
 }
 return <section className="space-y-5 rounded-2xl border bg-white p-5">
  <div className="flex justify-between gap-3"><div><h3 className="text-xl font-semibold">Counter POS · {menuName}</h3><p className="text-sm text-zinc-500">Create an order without leaving BeanBook.</p></div><button type="button" className="text-sm underline" onClick={onClose}>Close</button></div>
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {orderNumber?<div className="space-y-4 rounded-xl bg-emerald-50 p-5">
    <h4 className="font-bold text-emerald-900">Order recorded · {orderNumber}</h4>
    <p className="text-3xl font-bold">{amount===null?'Amount unavailable':money(amount)}</p>
    {paid?<p className="rounded-lg bg-emerald-100 p-3 font-semibold text-emerald-900">Payment confirmed and recorded.</p>:<>
      <p className="text-sm font-semibold">Collect payment directly for this order</p>
      {upiUri?<div className="flex flex-col items-center gap-2 rounded-xl bg-white p-5"><QRCodeCanvas value={upiUri} size={250} level="M" marginSize={4}/><p className="text-center text-sm">Scan to pay {money(amount||0)}</p><p className="text-xs text-zinc-600">{paymentSettings?.payee_name} · {paymentSettings?.upi_vpa}</p></div>:<p className="rounded-lg bg-amber-100 p-3 text-sm">UPI QR unavailable. Configure the café's own UPI ID in Business UPI Payments, or accept cash.</p>}
      <div className="flex gap-4 text-sm"><label><input type="radio" checked={paymentMethod==='upi'} onChange={()=>setPaymentMethod('upi')}/> UPI</label><label><input type="radio" checked={paymentMethod==='cash'} onChange={()=>setPaymentMethod('cash')}/> Cash</label></div>
      {paymentMethod==='upi'&&<label className="block text-sm">Verified UPI reference<input className={input+' mt-1'} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Reference from the payment received"/></label>}
      <button type="button" disabled={busy||(paymentMethod==='upi'&&(!upiUri||reference.trim().length<8))} onClick={()=>void confirmPayment()} className="rounded-xl bg-[#1b2822] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?'Confirming…':'Mark Payment Received'}</button>
      <p className="text-xs text-amber-900">The QR cannot automatically verify payment. Check the receiving account before marking Paid.</p>
    </>}
    <button type="button" className="rounded-xl border bg-white px-4 py-2 text-sm" onClick={()=>{setOrderNumber('');setAmount(null);setPaid(false);setReference('');setName('');setPhone('');setStarted(false);}}>New Customer</button>
  </div>:
  !started?<form onSubmit={begin} className="max-w-md space-y-4"><h4 className="font-semibold">1. Customer Details</h4><label className="block text-sm">Customer name *<input className={input+' mt-2'} value={name} onChange={e=>setName(e.target.value)} required autoComplete="name" placeholder="Customer name"/></label><label className="block text-sm">Phone number *<input className={input+' mt-2'} type="tel" value={phone} onChange={e=>setPhone(e.target.value)} required autoComplete="tel" placeholder="+919876543210"/></label><button className="rounded-xl bg-[#1b2822] px-5 py-3 font-semibold text-white">Continue to Menu</button></form>:
  <div className="space-y-5"><div className="rounded-xl bg-zinc-50 p-3 text-sm">Ordering for <strong>{name}</strong> · {phone} <button type="button" className="ml-2 underline" onClick={()=>setStarted(false)}>Edit</button></div>
   <h4 className="font-semibold">2. Select Items</h4>
   {!menu?<p>Loading menu…</p>:<div className="grid gap-3 sm:grid-cols-2">{menu.products.map(p=>{
    const choice=choices[p.id];const size=choice?.size||p.sizes[0]?.name||'';
    const eligible=links.filter(l=>l.product_id===p.id).map(l=>addons.find(a=>a.id===l.addon_id)).filter((a):a is Addon=>!!a&&a.is_active);
    return <div key={p.id} className="space-y-3 rounded-xl border p-4"><h5 className="font-semibold">{p.name}</h5><p className="text-sm text-zinc-500">{p.description}</p>
     {p.sizes.length>0&&<label className="block text-sm">Size<select className={input+' mt-1'} value={size} onChange={e=>setChoices(o=>({...o,[p.id]:{size:e.target.value,addons:[]}}))}>{p.sizes.map(s=><option key={s.name} value={s.name}>{s.name} · {money(s.price)}</option>)}</select></label>}
     {eligible.length>0&&<div className="space-y-1 text-sm"><strong>Add-ons</strong>{eligible.map(a=>{const price=prices.find(x=>x.addon_id===a.id&&x.size_name.toLowerCase()===(size||'standard').toLowerCase());if(!price)return null;return <label key={a.id} className="flex gap-2"><input type="checkbox" checked={(choice?.addons||[]).includes(a.id)} onChange={e=>setChoices(o=>{const v=o[p.id]||{size,addons:[]};return {...o,[p.id]:{...v,addons:e.target.checked?[...v.addons,a.id]:v.addons.filter(x=>x!==a.id)}};})}/>{a.name} +{money(price.price)}</label>;})}</div>}
     <button type="button" disabled={trackedIds.includes(p.id)} onClick={()=>add(p)} className="rounded-xl bg-[#1b2822] px-4 py-2 text-sm text-white disabled:bg-zinc-300">{trackedIds.includes(p.id)?'Stock reservation required':'Add to Order'}</button>
    </div>;
   })}</div>}
   <div className="space-y-3 rounded-xl border p-4"><h4 className="font-semibold">3. Order Summary</h4>{lines.map(l=>{const p=menu?.products.find(x=>x.id===l.product_id);return <div key={l.key} className="flex items-center justify-between gap-2 text-sm"><span>{p?.name} {l.size_name} × {l.quantity}</span><span>{money(lineTotal(l))}</span><button type="button" className="underline" onClick={()=>setLines(v=>v.filter(x=>x.key!==l.key))}>Remove</button></div>;})}<div className="flex justify-between border-t pt-3 font-bold"><span>Total</span><span>{money(lines.reduce((a,l)=>a+lineTotal(l),0))}</span></div><button type="button" disabled={busy||!lines.length} onClick={()=>void submit()} className="rounded-xl bg-[#1b2822] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?'Recording…':'Place Counter Order'}</button><p className="text-xs text-zinc-500">Amount is recalculated on the server. Payment remains pending until staff confirms collection.</p></div>
  </div>}
 </section>;
}
