import {useEffect,useMemo,useState,type FormEvent,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {QRCodeCanvas} from 'qrcode.react';
import {adminSupabase} from './client';

type Product={id:string;name:string;description:string|null;price:number|null;category?:string|null;sizes:{name:string;price:number}[];images:string[]};
type Addon={id:string;name:string;is_active:boolean};
type AddonPrice={addon_id:string;size_name:string;price:number};
type Link={product_id:string;addon_id:string};
type Line={key:string;product_id:string;size_name:string;quantity:number;addon_ids:string[]};
type Stage='customer'|'menu'|'payment';
type ExistingBill={id:string;number:string;customerName:string;customerPhone:string};
type Payment={upi_vpa:string;payee_name:string}|null;
const money=(n:number)=>'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const green='bg-[#1b2822] text-white';
const input='w-full rounded-2xl border border-[#dedfd9] bg-white px-4 py-3.5 text-base text-[#1b2822] outline-none focus:border-[#51745e] focus:ring-2 focus:ring-[#d9e7db]';
const primary='rounded-2xl bg-[#1b2822] px-5 py-3.5 font-semibold text-white transition hover:bg-[#314638] disabled:cursor-not-allowed disabled:opacity-45';

function CounterIcon({children}:{children:ReactNode}){return <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf2ed] text-xl text-[#2a4432]">{children}</span>;}

export default function CounterPOS({
 menuId,menuName,trackedIds,paymentSettings,businessName,onClose,existingBill
}:{menuId:string;menuName:string;trackedIds:string[];paymentSettings:Payment;businessName:string;onClose:()=>void;existingBill?:ExistingBill}){
 const [stage,setStage]=useState<Stage>(existingBill?'menu':'customer');
 const [phone,setPhone]=useState(existingBill?.customerPhone||'+91'),[name,setName]=useState(existingBill?.customerName||'');
 const [products,setProducts]=useState<Product[]>([]),[addons,setAddons]=useState<Addon[]>([]),[addonPrices,setAddonPrices]=useState<AddonPrice[]>([]),[links,setLinks]=useState<Link[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [query,setQuery]=useState(''),[category,setCategory]=useState('All');
 const [selected,setSelected]=useState<Product|null>(null),[selectedSize,setSelectedSize]=useState(''),[selectedAddons,setSelectedAddons]=useState<string[]>([]),[selectedQty,setSelectedQty]=useState(1);
 const [cart,setCart]=useState<Line[]>([]),[cartOpen,setCartOpen]=useState(false);
 const [orderNumber,setOrderNumber]=useState(''),[amount,setAmount]=useState<number|null>(null);
 const [billingMode,setBillingMode]=useState<'pay_first'|'open_bill'>('pay_first');
 const [defaultBillingMode,setDefaultBillingMode]=useState<'pay_first'|'open_bill'>('pay_first');
 const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
 const [paymentMethod,setPaymentMethod]=useState<'upi'|'cash'>('upi'),[reference,setReference]=useState(''),[paid,setPaid]=useState(false);

 useEffect(()=>{
  const old=document.body.style.overflow;
  document.body.style.overflow='hidden';
  return()=>{document.body.style.overflow=old;};
 },[]);
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  async function load(){
   try{
    const auth=await adminSupabase?.auth.getSession();
    const token=auth?.data.session?.access_token;
    if(!token)throw new Error('Your session has expired. Sign in again.');
    const [menuResponse,optionsResponse]=await Promise.all([
      fetch('/api/business-products?mode=public-menu&id='+encodeURIComponent(menuId),{signal:controller.signal}),
      fetch('/api/business-products?mode=options',{signal:controller.signal,headers:{Authorization:'Bearer '+token}})
    ]);
    const menuBody=await menuResponse.json(), optionsBody=await optionsResponse.json();
    if(!menuResponse.ok)throw new Error(menuBody.error||'This menu is unavailable.');
    if(!optionsResponse.ok)throw new Error(optionsBody.error||'Unable to load add-ons.');
    if(active){
      setProducts(menuBody.products||[]);
      setAddons(optionsBody.addons||[]);
      setAddonPrices(optionsBody.prices||[]);
      setLinks(optionsBody.links||[]);
      const billingResponse=await fetch('/api/business-products?mode=orders',{headers:{Authorization:'Bearer '+token},signal:controller.signal});
      if(billingResponse.ok){const bill=await billingResponse.json();setDefaultBillingMode(bill.billingMode==='open_bill'?'open_bill':'pay_first');setBillingMode(bill.billingMode==='open_bill'?'open_bill':'pay_first');}
    }
   }catch(e){if(active)setError(e instanceof Error?e.message:'Unable to load menu');}
   finally{if(active)setLoading(false);}
  }
  void load();
  return()=>{active=false;controller.abort();};
 },[menuId]);
 useEffect(()=>{
  if(!selected)return;
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setSelected(null);};
  window.addEventListener('keydown',onKey);
  return()=>window.removeEventListener('keydown',onKey);
 },[selected]);

 const categories=useMemo(()=>['All',...new Set(products.map(p=>p.category?.trim()||'').filter(Boolean))], [products]);
 const visible=useMemo(()=>products.filter(p=>(category==='All'||p.category===category)&&(!query.trim()||(p.name+' '+(p.description||'')).toLowerCase().includes(query.trim().toLowerCase()))),[products,category,query]);
 const count=cart.reduce((sum,line)=>sum+line.quantity,0);
 const lookupAddonPrice=(id:string,size:string)=>addonPrices.find(p=>p.addon_id===id&&p.size_name.toLowerCase()===(size||'standard').toLowerCase())?.price;
 const optionsFor=(product:Product,size:string)=>links.filter(l=>l.product_id===product.id).flatMap(link=>{
  const a=addons.find(item=>item.id===link.addon_id&&item.is_active);
  const price=lookupAddonPrice(link.addon_id,size);
  return a&&price!==undefined?[{...a,price:Number(price)}]:[];
 });
 const productPrice=(p:Product,size:string)=>Number(p.sizes.length?(p.sizes.find(s=>s.name===size)?.price??0):p.price??0);
 const lineAmount=(l:Line)=>{
  const p=products.find(v=>v.id===l.product_id);
  if(!p)return 0;
  return l.quantity*(productPrice(p,l.size_name)+l.addon_ids.reduce((sum,id)=>sum+Number(lookupAddonPrice(id,l.size_name)||0),0));
 };
 const total=cart.reduce((sum,l)=>sum+lineAmount(l),0);
 const upiUri=paymentSettings&&amount!==null&&amount>0?'upi://pay?'+new URLSearchParams({
   pa:paymentSettings.upi_vpa,pn:paymentSettings.payee_name,am:amount.toFixed(2),cu:'INR',tn:'BeanBook '+orderNumber
 }).toString():null;

 function exit(){
  if(busy)return;
  if(stage==='payment'&&!paid&&billingMode==='pay_first'&&!window.confirm('This order is saved but unpaid. Exit the POS anyway?'))return;
  if(stage==='menu'&&cart.length>0&&!window.confirm('Discard the unsaved cart and exit POS?'))return;
  onClose();
 }
 function startCustomer(e:FormEvent){
  e.preventDefault();
  if(name.trim().length<2||name.trim().length>120||!/^\+[1-9][0-9]{7,14}$/.test(phone.replace(/\s/g,''))){
   setError('Enter a customer name and international phone number (e.g. +919876543210).');return;
  }
  setPhone(phone.replace(/\s/g,''));setError('');setStage('menu');
 }
 function configure(p:Product){
  if(trackedIds.includes(p.id)){setError('This item needs stock reservations before it can be billed in POS.');return;}
  setSelected(p);setSelectedSize(p.sizes[0]?.name||'');setSelectedAddons([]);setSelectedQty(1);setError('');
 }
 function addToCart(){
  if(!selected)return;
  const key=[selected.id,selectedSize,[...selectedAddons].sort().join(',')].join('|');
  const prev=cart.find(l=>l.key===key);
  if(prev&&prev.quantity+selectedQty>20){setError('Maximum 20 units of the same configuration per order.');return;}
  setCart(old=>prev?old.map(l=>l.key===key?{...l,quantity:l.quantity+selectedQty}:l):[...old,{key,product_id:selected.id,size_name:selectedSize,quantity:selectedQty,addon_ids:[...selectedAddons]}]);
  setSelected(null);
 }
 function changeQuantity(key:string,delta:number){setCart(old=>old.map(l=>l.key===key?{...l,quantity:l.quantity+delta}:l).filter(l=>l.quantity>0&&l.quantity<=20));}
 async function authedPost(body:Record<string,unknown>){
  const auth=await adminSupabase?.auth.getSession();
  const token=auth?.data.session?.access_token;
  if(!token)throw new Error('Your session expired. Sign in again.');
  const response=await fetch('/api/business-products?mode=orders',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error||'Order service failed (HTTP '+response.status+'). Please retry or contact support.');
  if(!result)throw new Error('Order service returned an invalid response. Check orders before retrying.');
  return result;
 }
 async function placeOrder(){
  if(!cart.length||busy)return;
  setBusy(true);setError('');
  try{
   const response=await authedPost({
    ...(existingBill?{action:'addItems',orderId:existingBill.id,requestId}:{action:'create',requestId,billingMode,menuId,customerName:name.trim(),customerPhone:phone}),
    items:cart.map(l=>({product_id:l.product_id,size_name:l.size_name,quantity:l.quantity,addon_ids:l.addon_ids}))
   });
   const receipt=response.result;
   if(existingBill){if(!Number.isFinite(Number(receipt?.amount)))throw new Error('Bill was updated but the response was incomplete. Check Live Orders.');onClose();return;}
   if(typeof receipt?.orderNumber!=='string'||!Number.isFinite(Number(receipt.amount))||Number(receipt.amount)<=0)throw new Error('Order was submitted, but receipt details could not be loaded. Check Live Orders before retrying.');
   setOrderNumber(receipt.orderNumber);setAmount(Number(receipt.amount));setPaymentMethod(paymentSettings?'upi':'cash');
   setCartOpen(false);setStage('payment');
  }catch(e){setError(e instanceof Error?e.message:'Could not place order');setCartOpen(true);}
  finally{setBusy(false);}
 }
 async function confirmPayment(){
  if(busy)return;
  if(!window.confirm('Have you independently verified receipt of '+money(amount||0)+' in the business account or cash drawer?'))return;
  setBusy(true);setError('');
  try{
   if(billingMode==='open_bill')throw new Error('Open bills must be settled from Live Orders.');
   await authedPost({action:'confirmPayment',orderNumber,paymentMethod,transactionReference:reference.trim()});
   setPaid(true);
  }catch(e){setError(e instanceof Error?e.message:'Could not confirm payment');}
  finally{setBusy(false);}
 }
 function newSale(){
  setRequestId(crypto.randomUUID());setBillingMode(defaultBillingMode);setName('');setPhone('+91');setCart([]);setQuery('');setCategory('All');setOrderNumber('');setAmount(null);setReference('');setPaid(false);setPaymentMethod(paymentSettings?'upi':'cash');setError('');setStage('customer');
 }
 const renderCart=(mobile:boolean)=><div className="flex h-full flex-col bg-white">
  <div className="flex items-center justify-between gap-3 border-b border-[#eeeae4] px-5 py-4">
   <div><h3 className="text-lg font-bold">Current order</h3><p className="text-xs text-zinc-500">{count} item{count===1?'':'s'} · {name}</p></div>
   {mobile&&<button type="button" onClick={()=>setCartOpen(false)} className="rounded-xl border px-3 py-2 text-sm" aria-label="Close cart">Close</button>}
  </div>
  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
   {!cart.length?<div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center text-zinc-500"><span className="text-4xl" aria-hidden="true">🛍</span><p className="font-medium text-[#1b2822]">Your cart is empty</p><p className="max-w-48 text-sm">Tap any product to start a new order.</p></div>:
    cart.map(line=>{
     const product=products.find(p=>p.id===line.product_id);
     return <div key={line.key} className="rounded-2xl border border-[#eeeae4] p-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{product?.name||'Product'}</p>
       {line.size_name&&<p className="mt-0.5 text-xs text-zinc-500">{line.size_name}</p>}
       {line.addon_ids.length>0&&<p className="mt-0.5 text-xs text-zinc-500">{line.addon_ids.map(id=>addons.find(a=>a.id===id)?.name).filter(Boolean).join(', ')}</p>}
      </div><strong className="shrink-0 text-sm">{money(lineAmount(line))}</strong></div>
      <div className="mt-3 flex items-center justify-between">
       <div className="flex items-center rounded-xl border border-[#e1e1db]">
        <button type="button" onClick={()=>changeQuantity(line.key,-1)} className="h-9 w-10 text-lg" aria-label={'Remove one '+(product?.name||'item')}>−</button>
        <span className="min-w-7 text-center text-sm font-semibold">{line.quantity}</span>
        <button type="button" disabled={line.quantity>=20} onClick={()=>changeQuantity(line.key,1)} className="h-9 w-10 text-lg disabled:opacity-30" aria-label={'Add one '+(product?.name||'item')}>+</button>
       </div>
       <button type="button" onClick={()=>setCart(v=>v.filter(x=>x.key!==line.key))} className="px-2 py-2 text-xs font-semibold text-red-700">Remove</button>
      </div>
     </div>;
    })
   }
  </div>
  <div className="space-y-3 border-t border-[#eeeae4] bg-[#faf9f6] p-4">
   {existingBill&&<div className="border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-900">Add products to {existingBill.number} · {name} · {phone}</div>}
   {error&&<div role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">Could not confirm order: {error}</div>}
   <div className="flex items-center justify-between text-sm text-zinc-500"><span>{count} item{count===1?'':'s'}</span><span>Subtotal</span></div>
   <div className="flex items-center justify-between text-2xl font-bold"><span>Total</span><span>{money(total)}</span></div>
   <button type="button" className={primary+' w-full'} disabled={!cart.length||busy} onClick={()=>void placeOrder()}>{busy?'Saving…':existingBill?'Add to Bill · '+money(total):'Confirm Order · '+money(total)}</button>
   <p className="text-center text-[11px] leading-4 text-zinc-500">Final price is verified by BeanBook before payment.</p>
  </div>
 </div>;

 return createPortal(
  <div role="dialog" aria-modal="true" aria-label={businessName+' counter POS'} className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#f5f3ef] font-sans text-[#1b2822]">
   <header className="z-10 flex shrink-0 items-center justify-between gap-3 bg-[#1b2822] px-4 py-3 text-white shadow-md sm:px-7 sm:py-4">
    <div className="min-w-0"><p className="truncate text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">{businessName}</p><h1 className="truncate text-base font-bold sm:text-xl">{menuName} <span className="ml-1 text-xs font-normal text-white/55">/ Counter POS</span></h1></div>
    <button type="button" onClick={exit} className="shrink-0 rounded-xl border border-white/25 px-3 py-2 text-sm font-semibold transition hover:bg-white/10 sm:px-5">✕ Exit POS</button>
   </header>
   <div className="flex shrink-0 items-center justify-center gap-2 border-b border-[#e3e2dc] bg-white px-3 py-3 text-xs sm:gap-4 sm:text-sm">
    {([['customer','1','Customer'],['menu','2','Menu & Cart'],['payment','3','Payment']] as const).map(([id,num,label],index)=><div key={id} className="flex items-center gap-2">
      {index>0&&<span className="mr-1 h-px w-3 bg-[#d0d6ce] sm:w-10" />}
      <span className={'flex h-7 w-7 items-center justify-center rounded-full font-bold '+(stage===id?green:((stage==='menu'&&id==='customer')||(stage==='payment'&&id!=='payment'))?'bg-[#dceadd] text-[#1b5032]':'bg-[#f0f0ec] text-zinc-500')}>{num}</span>
      <span className={stage===id?'font-bold':'text-zinc-500'}>{label}</span>
     </div>)}
   </div>
   {error&&<div role="alert" className="z-20 flex shrink-0 items-start justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
     <span>{error}</span><button type="button" aria-label="Dismiss error" onClick={()=>setError('')}>✕</button>
    </div>}
   {stage==='customer'&&!existingBill&&<div className="min-h-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8 sm:py-12">
     <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[0.9fr_1.1fr] lg:overflow-hidden lg:rounded-[28px] lg:bg-white lg:shadow-lg">
      <div className="hidden flex-col justify-between bg-[#233b2c] p-10 text-white lg:flex">
       <span className="text-sm font-semibold tracking-[0.18em] text-white/60">A FRESH SALE</span>
       <div><span className="text-6xl" aria-hidden="true">☕</span><h2 className="mt-6 text-4xl font-bold leading-tight">Great coffee starts with a great welcome.</h2><p className="mt-4 leading-7 text-white/70">A quick check-in, their favourite order, and an easy payment.</p></div>
       <p className="text-xs text-white/50">BeanBook · Counter Register</p>
      </div>
      <form onSubmit={startCustomer} className="space-y-6 rounded-3xl border border-[#e8e5dd] bg-white p-6 shadow-sm sm:p-10 lg:rounded-none lg:border-none lg:shadow-none">
       <div><span className="text-xs font-bold uppercase tracking-[0.16em] text-[#65826f]">Step 1 of 3</span><h2 className="mt-2 text-2xl font-bold sm:text-3xl">Who are we serving?</h2><p className="mt-2 text-sm leading-6 text-zinc-500">Enter the customer's details to start the order.</p></div>
       <label className="block space-y-2 text-sm font-semibold">Phone number <span className="text-red-700">*</span><input type="tel" inputMode="tel" autoComplete="tel" required className={input} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+919876543210" /></label>
       <label className="block space-y-2 text-sm font-semibold">Customer name <span className="text-red-700">*</span><input type="text" autoComplete="name" required minLength={2} maxLength={120} className={input} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Rahul" /></label>
       <button type="submit" className={primary+' flex w-full items-center justify-center gap-3'}>Continue to Menu <span aria-hidden="true">→</span></button>
       <fieldset className="rounded-2xl border border-[#dce6da] bg-[#f7faf6] p-4"><legend className="px-2 text-sm font-bold">Payment timing for this bill</legend><div className="grid grid-cols-2 gap-3">{([['pay_first','Pay First','Pay before preparing'],['open_bill','Pay Later','Keep bill open']] as const).map(([value,title,detail])=><button key={value} type="button" aria-pressed={billingMode===value} onClick={()=>{setBillingMode(value);setRequestId(crypto.randomUUID());}} className={'rounded-xl border-2 p-3 text-left '+(billingMode===value?'border-[#29583b] bg-[#e5f2e7]':'border-zinc-200 bg-white')}><strong className="block text-sm">{title}</strong><span className="block text-xs text-zinc-600">{detail}</span></button>)}</div><p className="mt-2 text-xs text-zinc-500">The selection applies to this order only.</p></fieldset><p className="text-xs leading-5 text-zinc-500">Details are used for the business's order record. No customer account required.</p>
      </form>
     </div>
    </div>}
   {stage==='menu'&&<div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
    <div className="mx-auto flex h-full max-w-[1600px] flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_410px]">
     <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-5 sm:px-7 sm:pt-7 lg:pb-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
       <div className="flex items-center gap-3"><CounterIcon>👤</CounterIcon><div><p className="text-sm font-bold">{name.trim()}</p><p className="text-xs text-zinc-500">{phone}</p></div></div>
       {!existingBill&&<button type="button" onClick={()=>setStage('customer')} className="rounded-xl border border-[#e4e4db] px-4 py-2 text-sm font-semibold">Edit customer</button>}
      </div>
      <div className="mb-5"><p className="mb-2 text-xs font-bold uppercase text-emerald-800">{billingMode==='open_bill'?'Pay Later · Open Bill':'Pay First · Close bill after payment'}</p><h2 className="text-2xl font-bold sm:text-3xl">What can we get you?</h2><p className="mt-1 text-sm text-zinc-500">Choose a product and customize it for {name.trim()}.</p></div>
      <label className="mb-5 flex items-center gap-3 rounded-2xl border border-[#e2e3dc] bg-white px-4 py-3 shadow-sm">
       <span className="text-xl text-[#65826f]" aria-hidden="true">⌕</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search products…" className="min-w-0 flex-1 bg-transparent text-base outline-none" aria-label="Search products"/>
       {query&&<button type="button" className="text-sm text-zinc-500" onClick={()=>setQuery('')}>Clear</button>}
      </label>
      {categories.length>1&&<nav aria-label="Product categories" className="mb-5 flex gap-2 overflow-x-auto pb-1">{categories.map(cat=><button key={cat} type="button" onClick={()=>setCategory(cat)} className={'shrink-0 rounded-full px-5 py-2 text-sm font-semibold '+(cat===category?green:'border border-[#e0e2db] bg-white text-[#415147]')}>{cat}</button>)}</nav>}
      {loading?<div className="rounded-2xl bg-white p-8 text-center text-zinc-500">Loading products…</div>:visible.length===0?<div className="rounded-2xl bg-white p-8 text-center"><h3 className="font-bold">No matching products</h3><p className="mt-2 text-sm text-zinc-500">Try a different search or filter.</p></div>:
       <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {visible.map(p=>{
         const tracked=trackedIds.includes(p.id);
         const values=p.sizes.length?p.sizes.map(s=>Number(s.price)):[Number(p.price||0)];
         const base=Math.min(...values);
         return <article key={p.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#e4e4dc] bg-white shadow-sm transition hover:shadow-md">
          <div className="relative aspect-[5/4] bg-[#e9eee8]">
           {p.images?.[0]?<img src={p.images[0]} alt={p.name} className="h-full w-full object-cover" loading="lazy"/>:<div className="flex h-full items-center justify-center text-5xl text-[#9caf9c]" aria-hidden="true">☕</div>}
           {tracked&&<span className="absolute bottom-2 left-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">Stock controlled</span>}
          </div>
          <div className="flex flex-1 flex-col p-3 sm:p-4"><h3 className="line-clamp-2 text-sm font-bold leading-5 sm:text-base">{p.name}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{p.description||'Freshly prepared for you'}</p>
           <div className="mt-auto pt-4"><p className="mb-3 text-sm font-bold">{p.sizes.length?'From ':''}{money(base)}</p><button type="button" disabled={tracked} className={'w-full rounded-xl px-3 py-2.5 text-sm font-semibold '+(tracked?'cursor-not-allowed bg-zinc-100 text-zinc-500':green)} onClick={()=>configure(p)}>{tracked?'Unavailable in POS':'+ Add'}</button></div>
          </div>
         </article>;
        })}
       </div>}
      {trackedIds.length>0&&<p className="mt-5 text-xs text-amber-800">Stock-controlled products are disabled until reservation checks are implemented.</p>}
     </div>
     <aside className="hidden min-h-0 border-l border-[#e5e4df] bg-white lg:block">{renderCart(false)}</aside>
    </div>
    <button type="button" onClick={()=>setCartOpen(true)} className="fixed inset-x-3 bottom-3 z-[105] flex items-center justify-between gap-3 rounded-2xl bg-[#1b2822] px-5 py-4 font-bold text-white shadow-xl lg:hidden" aria-label={'View current order, '+count+' items, '+money(total)}>
     <span>🛍 View Order · {count} item{count===1?'':'s'}</span><span>{money(total)} →</span>
    </button>
    {cartOpen&&<div className="fixed inset-0 z-[120] lg:hidden" role="dialog" aria-modal="true" aria-label="Current order">
      <button type="button" onClick={()=>setCartOpen(false)} className="absolute inset-0 bg-black/60" aria-label="Close cart"/>
      <div className="absolute inset-x-0 bottom-0 h-[min(86dvh,850px)] overflow-hidden rounded-t-3xl bg-white shadow-2xl">{renderCart(true)}</div>
     </div>}
   </div>}
   {stage==='payment'&&<div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:p-8">
     <div className="mx-auto max-w-4xl space-y-5">
      <div className="rounded-3xl bg-white p-6 text-center shadow-sm sm:p-8">
       <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e5f1e7] text-3xl text-[#266343]">✓</div>
       <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#62816d]">Order confirmed</p>
       <h2 className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">{amount===null?'—':money(amount)}</h2>
       <p className="mt-3 break-all text-sm text-zinc-500">{orderNumber} · {name}</p>
       <span className={'mt-4 inline-flex rounded-full px-3 py-1.5 text-xs font-bold '+(paid?'bg-green-100 text-green-900':'bg-amber-100 text-amber-900')}>{paid?'Payment received':'Awaiting payment'}</span>
      </div>
      {billingMode==='open_bill'&&!paid?<div className="space-y-4 rounded-3xl bg-white p-6 text-center"><h3 className="text-xl font-bold">Open bill created</h3><p className="text-sm text-zinc-600">Preparation can begin now. Add items and settle the final amount from Live Orders.</p><button type="button" className={primary} onClick={onClose}>Return to workspace</button></div>:paid?<div className="space-y-4 rounded-3xl border border-[#bedfc4] bg-white p-6 text-center sm:p-8">
        <div className="text-5xl" aria-hidden="true">🎉</div><h3 className="text-2xl font-bold text-[#1b5032]">Payment recorded successfully!</h3>
        <p className="text-sm text-zinc-600">The order is paid and ready for the café's next fulfillment step.</p>
        <button type="button" onClick={newSale} className={primary+' w-full sm:w-auto'}>+ Start New Sale</button>
       </div>:
       <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-7">
         <h3 className="text-xl font-bold">Collect payment</h3><p className="mt-1 text-sm text-zinc-500">Choose how the customer would like to pay.</p>
         <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" disabled={!paymentSettings} onClick={()=>setPaymentMethod('upi')} className={'rounded-2xl border-2 p-4 text-center text-sm font-bold '+(paymentMethod==='upi'?'border-[#274e34] bg-[#eff6ef]':'border-[#e8e8e3]')+' disabled:opacity-40'}>▦ UPI</button>
          <button type="button" onClick={()=>setPaymentMethod('cash')} className={'rounded-2xl border-2 p-4 text-center text-sm font-bold '+(paymentMethod==='cash'?'border-[#274e34] bg-[#eff6ef]':'border-[#e8e8e3]')}>₹ Cash</button>
         </div>
         {paymentMethod==='upi'&&upiUri?<div className="mt-5 flex flex-col items-center gap-3 rounded-2xl bg-[#f9faf7] p-5">
           <div className="rounded-2xl bg-white p-4"><QRCodeCanvas size={240} value={upiUri} level="M" marginSize={4} className="max-w-full"/></div>
           <p className="text-lg font-bold">Scan to pay {money(amount||0)}</p>
           <p className="break-all text-center text-xs text-zinc-500">{paymentSettings?.payee_name} · {paymentSettings?.upi_vpa}</p>
          </div>:paymentMethod==='cash'?<div className="mt-5 rounded-2xl bg-[#f8f6f0] p-6 text-center"><CounterIcon>₹</CounterIcon><p className="mt-3 text-xl font-bold">Collect {money(amount||0)} in cash</p><p className="mt-1 text-sm text-zinc-500">Count the cash received before confirming.</p></div>:<p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Configure the café's UPI account in Business Settings before accepting UPI.</p>}
        </section>
        <section className="flex flex-col rounded-3xl bg-white p-5 shadow-sm sm:p-7"><h3 className="text-xl font-bold">Verify payment</h3>
         <p className="mt-2 text-sm leading-6 text-zinc-500">Check the receiving bank or UPI app. Scanning a QR alone does not prove payment.</p>
         {paymentMethod==='upi'&&<label className="mt-6 block space-y-2 text-sm font-semibold">UPI transaction reference<input className={input} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Transaction reference from payment received" autoComplete="off"/></label>}
         <div className="mt-auto pt-8"><button type="button" onClick={()=>void confirmPayment()} disabled={busy||(paymentMethod==='upi'&&(!upiUri||!/^[A-Za-z0-9-]{8,35}$/.test(reference.trim())))} className={primary+' w-full'}>{busy?'Verifying…':'Verify & Mark Paid'}</button>
          <p className="mt-3 text-center text-xs leading-5 text-zinc-500">Only authorized café staff can record payment confirmation.</p>
         </div>
        </section>
       </div>}
      {!paid&&billingMode==='pay_first'&&<div className="text-center"><button type="button" onClick={exit} className="rounded-xl border border-[#deded7] bg-white px-5 py-3 text-sm font-semibold">Exit and leave order pending</button></div>}
     </div>
    </div>}
   {selected&&<div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/60 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={'Customize '+selected.name}>
    <button type="button" className="absolute inset-0" onClick={()=>setSelected(null)} aria-label="Close customization"/>
    <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <div className="flex items-start justify-between gap-4 border-b border-[#eeeae4] p-5"><div><p className="text-xs font-bold uppercase tracking-wider text-[#64836d]">Customize your item</p><h2 className="mt-1 text-2xl font-bold">{selected.name}</h2></div>
        <button type="button" onClick={()=>setSelected(null)} className="rounded-full bg-[#f1f2ed] px-3 py-2" aria-label="Close">✕</button></div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
       {selected.sizes.length>0&&<fieldset><legend className="mb-3 font-bold">Choose a size</legend><div className="grid grid-cols-2 gap-2">{selected.sizes.map(s=><button key={s.name} type="button" onClick={()=>{setSelectedSize(s.name);setSelectedAddons([]);}} className={'rounded-2xl border-2 p-3 text-left '+(selectedSize===s.name?'border-[#315a3d] bg-[#f0f6ef]':'border-[#e5e6df]')}><span className="block font-semibold">{s.name}</span><span className="text-sm text-zinc-500">{money(s.price)}</span></button>)}</div></fieldset>}
       {optionsFor(selected,selectedSize).length>0&&<fieldset><legend className="mb-3 font-bold">Make it yours <span className="text-xs font-normal text-zinc-500">(optional)</span></legend><div className="space-y-2">{optionsFor(selected,selectedSize).map(a=><label key={a.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-3"><span className="flex items-center gap-3"><input type="checkbox" checked={selectedAddons.includes(a.id)} onChange={e=>setSelectedAddons(v=>e.target.checked?[...v,a.id]:v.filter(id=>id!==a.id))}/><span className="text-sm font-semibold">{a.name}</span></span><span className="text-sm">+{money(a.price)}</span></label>)}</div></fieldset>}
       <div className="flex items-center justify-between gap-3"><span className="font-bold">Quantity</span><div className="flex items-center rounded-xl border"><button type="button" onClick={()=>setSelectedQty(q=>Math.max(1,q-1))} className="h-11 w-12 text-xl">−</button><span className="min-w-9 text-center font-bold">{selectedQty}</span><button type="button" onClick={()=>setSelectedQty(q=>Math.min(20,q+1))} className="h-11 w-12 text-xl">+</button></div></div>
      </div>
      <div className="border-t bg-white p-5"><button type="button" onClick={addToCart} className={primary+' flex w-full justify-between'}><span>Add to Order</span><span>{money(selectedQty*(productPrice(selected,selectedSize)+selectedAddons.reduce((sum,id)=>sum+Number(lookupAddonPrice(id,selectedSize)||0),0)))}</span></button></div>
    </div>
   </div>}
  </div>,
  document.body
 );
}
