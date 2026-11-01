import {useCallback,useEffect,useMemo,useState} from 'react';
import {QRCodeCanvas} from 'qrcode.react';
import CounterPOS from './CounterPOS';
import {adminSupabase} from './client';

type Addon={addon_name:string;unit_price:number|string};
type Item={id:string;product_id:string;quantity:number;unit_price:number|string;size_name:string|null;prep_started_at:string|null;prep_ready_at:string|null;fulfillment_status:'received'|'preparing'|'ready'|'completed'|'cancelled';round_number:number|null;products:{name:string}|{name:string}[]|null;order_item_addons:Addon[]};
type Order={id:string;order_number:string;event_id:string;created_at:string;total_amount:number|string;payment_status:string;paid_at:string|null;billing_mode:'pay_first'|'open_bill';billing_status:'open'|'settlement_in_progress'|'settled'|'voided';order_items:Item[];customers:{name:string;phone:string}|{name:string;phone:string}[]|null};
type MenuProduct={id:string;name:string;price:number|null;sizes:{name:string;price:number}[]};
type Opt={id:string;name:string;is_active:boolean};
type OptionPrice={addon_id:string;size_name:string;price:number};
type Allowed={product_id:string;addon_id:string};
type BasketLine={product_id:string;size_name:string;quantity:number;addon_ids:string[]};
const money=(n:number|string)=>'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const primary='rounded-xl bg-[#1b2822] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40';
const secondary='rounded-xl border border-[#d7ded5] bg-white px-4 py-2.5 text-sm font-semibold text-[#233b2c] disabled:opacity-40';
const label=(v:Item['products']|Order['customers'])=>Array.isArray(v)?v[0]?.name||'Walk-in customer':v?.name||'Walk-in customer';
const clock=(start:string,finish:number)=>{const seconds=Math.max(0,Math.floor((finish-Date.parse(start))/1000));return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(v=>String(v).padStart(2,'0')).join(':');};
const customerPhone=(c:Order['customers'])=>(Array.isArray(c)?c[0]?.phone:c?.phone)||'';
const elapsed=(s:string,now:number)=>{const m=Math.max(0,Math.floor((now-Date.parse(s))/60000));return m<1?'Just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h '+m%60+'m ago':Math.floor(m/1440)+'d ago'};
async function request(body?:Record<string,unknown>){
 const auth=await adminSupabase?.auth.getSession();const token=auth?.data.session?.access_token;
 if(!token)throw new Error('Sign in again to view orders.');
 const r=await fetch('/api/business-products?mode=orders',{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await r.json().catch(()=>null);
 if(!r.ok)throw new Error(result?.error||'Order request failed (HTTP '+r.status+')');
 return result;
}
export default function LiveOrders(){
 const [orders,setOrders]=useState<Order[]>([]),[mode,setMode]=useState<'pay_first'|'open_bill'>('pay_first');
 const [filter,setFilter]=useState<'active'|'history'>('active'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [now,setNow]=useState(Date.now()),[loading,setLoading]=useState(true);
 const [addToBill,setAddToBill]=useState<string|null>(null);
 const [selected,setSelected]=useState<string|null>(null),[paymentMethod,setPaymentMethod]=useState<'cash'|'upi'>('cash'),[reference,setReference]=useState('');
 const [paymentSettings,setPaymentSettings]=useState<{upi_vpa:string;payee_name:string}|null>(null);
 const [adding,setAdding]=useState(false),[products,setProducts]=useState<MenuProduct[]>([]),[addons,setAddons]=useState<Opt[]>([]),[prices,setPrices]=useState<OptionPrice[]>([]),[allowed,setAllowed]=useState<Allowed[]>([]);
 const [tracked,setTracked]=useState<string[]>([]),[productId,setProductId]=useState(''),[sizeName,setSizeName]=useState(''),[addonIds,setAddonIds]=useState<string[]>([]),[qty,setQty]=useState(1),[basket,setBasket]=useState<BasketLine[]>([]);
 const [addRequestId,setAddRequestId]=useState(()=>crypto.randomUUID());
 const [search,setSearch]=useState('');
 const refresh=useCallback(async()=>{const d=await request();setOrders(d.orders||[]);setMode(d.billingMode==='open_bill'?'open_bill':'pay_first');setError('');setLoading(false);},[]);
 useEffect(()=>{let active=true;void refresh().catch(e=>{if(active){setError(e instanceof Error?e.message:String(e));setLoading(false);}});
  const timer=window.setInterval(()=>{setNow(Date.now());},1000);
  const poll=window.setInterval(()=>{if(!document.hidden)void refresh().catch(()=>{});},6000);
  const onFocus=()=>{void refresh().catch(()=>{});};window.addEventListener('focus',onFocus);
  return()=>{active=false;clearInterval(timer);clearInterval(poll);window.removeEventListener('focus',onFocus);};
 },[refresh]);
 const chosen=orders.find(o=>o.id===selected);
 const active=useMemo(()=>orders.filter(o=>o.billing_status!=='settled'&&o.billing_status!=='voided'&&o.order_items.some(i=>i.fulfillment_status!=='cancelled'&&(i.fulfillment_status!=='completed'||o.payment_status!=='paid'))),[orders]);
 const history=useMemo(()=>orders.filter(o=>!active.some(a=>a.id===o.id)),[orders,active]);
 const shown=(filter==='active'?active:history).filter(o=>(o.order_number+' '+label(o.customers)).toLowerCase().includes(search.toLowerCase()));
 const collect=async(action:string,payload:Record<string,unknown>)=>{if(busy)return;setBusy(true);setError('');try{const result=await request({action,...payload});await refresh();return result;}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const itemNext=(s:Item['fulfillment_status'])=>s==='received'?'preparing':s==='preparing'?'ready':s==='ready'?'completed':null;
 async function loadMenu(o:Order){
  setAdding(true);setProducts([]);setBasket([]);setAddRequestId(crypto.randomUUID());setError('');
  try{
   const token=(await adminSupabase?.auth.getSession())?.data.session?.access_token;
   if(!token)throw new Error('Session expired');
   const [m,a,b]=await Promise.all([fetch('/api/business-products?mode=public-menu&id='+encodeURIComponent(o.event_id)),fetch('/api/business-products?mode=options',{headers:{Authorization:'Bearer '+token}}),fetch('/api/business-products?mode=menus',{headers:{Authorization:'Bearer '+token}})]);
   const md=await m.json(),ad=await a.json(),bd=b.ok?await b.json():{};
   if(!m.ok||!a.ok)throw new Error(md.error||ad.error||'Menu unavailable');
   setProducts(md.products||[]);setAddons(ad.addons||[]);setPrices(ad.prices||[]);setAllowed(ad.links||[]);
   setTracked((bd.items||[]).filter((i:{event_id:string;inventory_tracking:boolean})=>i.event_id===o.event_id&&i.inventory_tracking).map((i:{product_id:string})=>i.product_id));
  }catch(e){setError(e instanceof Error?e.message:String(e));}
 }
 const picked=products.find(p=>p.id===productId);
 const validAddons=addons.filter(a=>a.is_active&&allowed.some(l=>l.product_id===productId&&l.addon_id===a.id)&&prices.some(p=>p.addon_id===a.id&&p.size_name.toLowerCase()===(sizeName||'standard').toLowerCase()));
 const unitPrice=(p:MenuProduct,size:string,ids:string[])=>Number((p.sizes.length?p.sizes.find(s=>s.name===size)?.price:p.price)||0)+ids.reduce((sum,id)=>sum+Number(prices.find(x=>x.addon_id===id&&x.size_name.toLowerCase()===(size||'standard').toLowerCase())?.price||0),0);
 const upiUri=chosen&&paymentSettings&&paymentMethod==='upi'?'upi://pay?'+new URLSearchParams({pa:paymentSettings.upi_vpa,pn:paymentSettings.payee_name,am:Number(chosen.total_amount).toFixed(2),cu:'INR',tn:'BeanBook '+chosen.order_number}).toString():null;
 async function begin(o:Order){const r=await collect('beginSettlement',{orderId:o.id});if(r){setSelected(o.id);setAdding(false);}}
 async function settle(o:Order){
  if(!window.confirm('Have you independently verified '+money(o.total_amount)+' received via '+paymentMethod.toUpperCase()+'?'))return;
  const result=await collect('confirmPayment',{orderNumber:o.order_number,paymentMethod,transactionReference:reference.trim()});
  if(result){setSelected(null);setReference('');setPaymentMethod('cash');}
 }
 useEffect(()=>{if(!selected)return;let live=true;const load=async()=>{try{const token=(await adminSupabase?.auth.getSession())?.data.session?.access_token;if(!token)return;const r=await fetch('/api/business-products?mode=menus',{headers:{Authorization:'Bearer '+token}});if(r.ok){const d=await r.json();if(live)setPaymentSettings(d.paymentSettings||null);}}catch{ /* Cash remains available */ }};void load();return()=>{live=false;};},[selected]);
 return <section className="space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-zinc-500">Orders refresh every few seconds · Default: {mode==='open_bill'?'Pay Later':'Pay First'} · Each bill chooses its own mode</p><p className="mt-1 text-xs text-zinc-400">Only new counter orders appear here; legacy checkout records are excluded.</p></div><button className={secondary} onClick={()=>void refresh().catch(e=>setError(String(e)))}>↻ Refresh</button></div>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-sm text-zinc-500">Active bills</p><p className="mt-2 text-3xl font-bold">{active.length}</p></div><div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-sm text-zinc-500">Waiting for payment</p><p className="mt-2 text-3xl font-bold">{active.filter(o=>o.payment_status!=='paid').length}</p></div><div className="col-span-2 rounded-2xl bg-white p-4 shadow-sm sm:col-span-1"><p className="text-sm text-zinc-500">Preparing / Ready</p><p className="mt-2 text-3xl font-bold">{active.flatMap(o=>o.order_items).filter(i=>['preparing','ready'].includes(i.fulfillment_status)).length}</p></div></div>
  <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex rounded-xl bg-white p-1 shadow-sm"><button className={'rounded-lg px-4 py-2 text-sm font-semibold '+(filter==='active'?'bg-[#1b2822] text-white':'text-zinc-600')} onClick={()=>setFilter('active')}>Active ({active.length})</button><button className={'rounded-lg px-4 py-2 text-sm font-semibold '+(filter==='history'?'bg-[#1b2822] text-white':'text-zinc-600')} onClick={()=>setFilter('history')}>History ({history.length})</button></div><input className="min-w-0 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm" placeholder="Find customer or bill…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
  {loading?<div className="rounded-2xl bg-white p-10 text-center text-zinc-500">Loading orders…</div>:shown.length===0?<div className="rounded-3xl border border-dashed border-[#d8ded5] bg-white p-10 text-center"><span className="text-4xl">☕</span><h3 className="mt-3 text-xl font-semibold">No {filter==='active'?'active orders':'completed orders'} yet</h3><p className="mt-2 text-sm text-zinc-500">Create a counter sale from Events & Menus. It will appear here automatically.</p></div>:
  <div className="grid items-start gap-4 xl:grid-cols-2">{shown.map(o=><article key={o.id} className="overflow-hidden rounded-3xl border border-[#e4e9e0] bg-white shadow-sm">
   <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 p-5"><div><h3 className="text-lg font-bold">{o.order_number}</h3><p className="mt-1 text-sm text-zinc-600">{label(o.customers)} · {elapsed(o.created_at,now)}</p><p className="mt-2 text-xs font-semibold tabular-nums text-[#31553b]">◷ Order Active Time: {clock(o.created_at,now)}</p></div><div className="text-right"><strong className="text-xl">{money(o.total_amount)}</strong><p className="mt-1 text-xs text-zinc-500">{o.billing_mode==='open_bill'?'Open bill':'Pay first'} · {o.billing_status.replaceAll('_',' ')}</p><p className={'mt-1 text-xs font-semibold '+(o.payment_status==='paid'?'text-emerald-700':'text-amber-700')}>{o.payment_status==='paid'?'Paid':o.payment_status.replaceAll('_',' ')}</p></div></header>
   <div className="space-y-3 p-5">{o.order_items.map(i=><div key={i.id} className={'rounded-2xl border p-3 '+(i.fulfillment_status==='cancelled'?'border-zinc-100 bg-zinc-50 opacity-60':'border-[#e5e9e2]')}>
     <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{i.quantity} × {label(i.products)}</p><p className="mt-1 text-xs text-zinc-500">{[i.size_name,i.order_item_addons?.map(a=>a.addon_name).join(', ')].filter(Boolean).join(' · ')||'Standard'} · Round {i.round_number||1}</p></div><strong className="text-sm">{money(Number(i.unit_price)*i.quantity)}</strong></div>
     <div className="mt-2 text-xs font-semibold tabular-nums text-zinc-600">◷ Prep Time: {i.prep_started_at?clock(i.prep_started_at,i.prep_ready_at?Date.parse(i.prep_ready_at):now):'00:00:00'}{i.prep_ready_at?' · Finished':i.prep_started_at?' · Running':' · Not started'}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-[#eef3ed] px-3 py-1 text-xs font-semibold capitalize text-[#31533b]">{i.fulfillment_status}</span>{itemNext(i.fulfillment_status)&&<button disabled={busy||o.payment_status==='paid_stock_issue'||(o.billing_mode==='pay_first'&&o.payment_status!=='paid')} className={secondary} onClick={()=>void collect('advanceItem',{itemId:i.id,nextStatus:itemNext(i.fulfillment_status)})}>{i.fulfillment_status==='received'?'Start Preparing':i.fulfillment_status==='preparing'?'Mark Ready':'Mark Served'}</button>}</div>
     {o.billing_mode==='open_bill'&&o.billing_status==='open'&&i.fulfillment_status==='received'&&<button disabled={busy} className="mt-2 text-xs font-semibold text-red-700 underline" onClick={()=>{const reason=window.prompt('Reason for cancelling this unprepared item?');if(reason)void collect('cancelItem',{itemId:i.id,reason});}}>Cancel item</button>}
    </div>)}</div>
   <footer className="flex flex-wrap gap-2 border-t border-zinc-100 bg-[#fafbf9] p-4">
    {o.billing_mode==='open_bill'&&o.billing_status==='open'&&<><button className={secondary} disabled={busy} onClick={()=>{setAddToBill(o.id);void loadMenu(o);}}>+ Add Products</button><button className={primary} disabled={busy} onClick={()=>void begin(o)}>Settle Bill · {money(o.total_amount)}</button></>}
    {o.billing_mode==='open_bill'&&o.billing_status==='settlement_in_progress'&&<button className={primary} onClick={()=>{setSelected(o.id);setAdding(false);}}>Continue Settlement</button>}
    {o.billing_mode==='pay_first'&&o.payment_status==='pending'&&<button className={primary} onClick={()=>{setSelected(o.id);setAdding(false);}}>Collect Payment</button>}
   </footer></article>)}</div>}
  {addToBill&&(()=>{const o=orders.find(x=>x.id===addToBill);return o&&o.billing_mode==='open_bill'&&o.billing_status==='open'&&o.payment_status==='pending'?<CounterPOS key={o.id} menuId={o.event_id} menuName="Add Products" trackedIds={[]} paymentSettings={null} businessName="BeanBook" existingBill={{id:o.id,number:o.order_number,customerName:label(o.customers),customerPhone:customerPhone(o.customers)}} onClose={()=>{setAddToBill(null);void refresh().catch(()=>{});}}/>:null;})()}
  {chosen&&<div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={adding?'Add Items':'Settle Bill'}>
   <div className="flex max-h-[95dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
    <div className="flex items-start justify-between border-b p-5"><div><p className="text-xs font-semibold uppercase text-emerald-700">{chosen.order_number}</p><h3 className="mt-1 text-2xl font-bold">{adding?'Add to open bill':'Collect payment'}</h3><p className="mt-1 text-sm text-zinc-500">{label(chosen.customers)}</p></div><button className={secondary} onClick={()=>{setSelected(null);setAdding(false);setError('');}}>✕</button></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
    {adding?<><p className="text-sm text-zinc-500">New items get their own preparation round. Final prices are recalculated by BeanBook.</p>
     <label className="block space-y-1 text-sm font-semibold">Product<select className="w-full rounded-xl border p-3" value={productId} onChange={e=>{const v=products.find(p=>p.id===e.target.value);setProductId(e.target.value);setSizeName(v?.sizes?.[0]?.name||'');setAddonIds([]);}}><option value="">Choose product</option>{products.filter(p=>!tracked.includes(p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
     {picked&&<>{picked.sizes.length>0&&<label className="block space-y-1 text-sm font-semibold">Size<select className="w-full rounded-xl border p-3" value={sizeName} onChange={e=>{setSizeName(e.target.value);setAddonIds([]);}}>{picked.sizes.map(s=><option key={s.name}>{s.name}</option>)}</select></label>}
     {validAddons.map(a=><label key={a.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" checked={addonIds.includes(a.id)} onChange={e=>setAddonIds(old=>e.target.checked?[...old,a.id]:old.filter(id=>id!==a.id))}/>{a.name}</label>)}
     <label className="block text-sm">Quantity<input type="number" min="1" max="20" className="ml-3 w-20 rounded-xl border p-2" value={qty} onChange={e=>setQty(Math.max(1,Math.min(20,Number(e.target.value)||1)))}/></label>
     <button className={secondary} onClick={()=>{setBasket(old=>[...old,{product_id:picked.id,size_name:sizeName,addon_ids:[...addonIds],quantity:qty}]);setProductId('');setAddonIds([]);setQty(1);}}>+ Add {money(unitPrice(picked,sizeName,addonIds)*qty)} to basket</button></>}
     {basket.map((b,i)=><div key={i} className="flex justify-between rounded-xl bg-[#f4f7f2] p-3 text-sm"><span>{b.quantity} × {products.find(p=>p.id===b.product_id)?.name} {b.size_name}</span><button className="font-semibold text-red-700" onClick={()=>setBasket(v=>v.filter((_,n)=>i!==n))}>Remove</button></div>)}
     <button className={primary+' w-full'} disabled={busy||basket.length===0} onClick={()=>void (async()=>{const result=await collect('addItems',{orderId:chosen.id,requestId:addRequestId,items:basket});if(result){setAdding(false);setSelected(null);setBasket([]);setAddRequestId(crypto.randomUUID());}})()}>Add {basket.length} configuration(s) to bill</button>
    </>:<><div className="rounded-2xl bg-[#f3f7f1] p-5 text-center"><p className="text-sm text-zinc-500">Amount to collect</p><p className="mt-2 text-4xl font-bold">{money(chosen.total_amount)}</p><p className="mt-2 text-xs text-zinc-500">Bill is locked during settlement</p></div>
     <div className="grid grid-cols-2 gap-3"><button className={secondary+(paymentMethod==='cash'?' border-emerald-700 bg-emerald-50':'')} onClick={()=>setPaymentMethod('cash')}>Cash</button><button disabled={!paymentSettings} className={secondary+(paymentMethod==='upi'?' border-emerald-700 bg-emerald-50':'')} onClick={()=>setPaymentMethod('upi')}>Self UPI</button></div>
     {paymentMethod==='upi'&&upiUri&&<div className="flex flex-col items-center gap-2 rounded-2xl border p-4"><QRCodeCanvas size={220} value={upiUri}/><p className="text-sm">Scan to pay {money(chosen.total_amount)}</p><input className="w-full rounded-xl border p-3" placeholder="Verified UPI transaction reference" value={reference} onChange={e=>setReference(e.target.value)}/></div>}
     <p className="text-sm text-zinc-500">Confirm only after you have verified the payment yourself.</p>
     <button className={primary+' w-full'} disabled={busy||(paymentMethod==='upi'&&!/^[A-Za-z0-9-]{8,35}$/.test(reference))} onClick={()=>void settle(chosen)}>Verify & Mark Paid</button>
    </>}
    </div>
   </div>
  </div>}
 </section>;
}
