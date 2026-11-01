import {useEffect,useState} from 'react';
type Product={id:string;name:string;description:string|null;price:number|null;sizes:{name:string;price:number}[];images:string[]};
type MenuData={business:string;menu:{name:string;location:string|null;sales_mode:string;start:string|null;end:string|null};products:Product[]};
const money=(n:number)=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
export default function PublicSalesMenu({menuId}:{menuId:string}){
 const [data,setData]=useState<MenuData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{const ctrl=new AbortController();setLoading(true);setError('');
  void fetch('/api/business-products?mode=public-menu&id='+encodeURIComponent(menuId||''),{signal:ctrl.signal})
   .then(async res=>{const value=await res.json();if(!res.ok)throw new Error(value.error||'Menu unavailable');setData(value);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Menu unavailable');})
   .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return()=>ctrl.abort();
 },[menuId]);
 return <main className="mx-auto min-h-screen max-w-4xl space-y-6 bg-[#f5f3ef] px-4 py-8 text-[#1b2822]">
  {loading?<p className="text-center">Loading menu…</p>:error?<section className="rounded-2xl border bg-white p-8 text-center"><h1 className="text-xl font-semibold">Menu unavailable</h1><p className="mt-2 text-sm">{error}</p></section>:data&&<>
   <header className="rounded-2xl bg-white p-6 shadow-sm"><p className="text-xs uppercase tracking-wider text-emerald-700">{data.business}</p><h1 className="mt-2 text-3xl font-semibold">{data.menu.name}</h1>
    {data.menu.location&&<p className="mt-2 text-zinc-600">{data.menu.location}</p>}
    {data.menu.sales_mode==='event'&&<p className="mt-2 text-sm text-zinc-500">{data.menu.start} to {data.menu.end}</p>}
    <p className="mt-3 text-xs font-semibold text-amber-800">Menu preview · Online ordering is coming soon</p>
   </header>
   <div className="grid gap-4 sm:grid-cols-2">{data.products.map(p=><article key={p.id} className="overflow-hidden rounded-2xl border bg-white">
     {p.images[0]&&<img src={p.images[0]} alt={p.name} className="h-48 w-full object-cover"/>}
     <div className="space-y-2 p-5"><h2 className="text-lg font-semibold">{p.name}</h2>{p.description&&<p className="text-sm text-zinc-500">{p.description}</p>}
      {p.sizes.length?p.sizes.map(s=><div key={s.name} className="flex justify-between text-sm"><span>{s.name}</span><strong>{money(s.price)}</strong></div>):<p className="font-semibold">{money(Number(p.price))}</p>}
     </div>
    </article>)}</div>
   {!data.products.length&&<p className="rounded-xl bg-white p-7 text-center">No products are currently available on this menu.</p>}
  </>}
 </main>;
}
