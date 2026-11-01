import {useEffect,useMemo,useState} from 'react';
type Product={id:string;name:string;description:string|null;price:number|null;sizes:{name:string;price:number}[];images:string[];category?:string|null};
type MenuData={business:string;menu:{name:string;location:string|null;sales_mode:string;start:string|null;end:string|null};products:Product[]};
const money=(n:number)=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
export default function PublicSalesMenu({menuId}:{menuId:string}){
 const [data,setData]=useState<MenuData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [search,setSearch]=useState(''),[category,setCategory]=useState('All');
 useEffect(()=>{const ctrl=new AbortController();setLoading(true);setError('');
  void fetch('/api/business-products?mode=public-menu&id='+encodeURIComponent(menuId||''),{signal:ctrl.signal})
   .then(async res=>{const value=await res.json();if(!res.ok)throw new Error(value.error||'Menu unavailable');setData(value);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Menu unavailable');})
   .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return()=>ctrl.abort();
 },[menuId]);
 const categories=useMemo(()=>['All',...new Set((data?.products||[]).map(p=>p.category?.trim()).filter((v):v is string=>!!v))],[data]);
 const products=useMemo(()=>(data?.products||[]).filter(p=>(category==='All'||p.category===category)&&(!search.trim()||(p.name+' '+(p.description||'')).toLowerCase().includes(search.toLowerCase().trim()))),[data,category,search]);
 return <main className="min-h-screen bg-[#faf7f2] text-[#34271f]">
  <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6">
   {loading?<p role="status" className="py-20 text-center">Preparing your menu…</p>:error?<section className="rounded-3xl bg-white p-10 text-center"><h1 className="text-2xl font-bold">Menu unavailable</h1><p className="mt-3 text-sm">{error}</p></section>:data&&<>
    <header className="overflow-hidden rounded-3xl border border-[#e9ded2] bg-[#4a3026] p-7 text-white sm:p-12">
     <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#e8cbb3]">{data.business}</p>
     <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">{data.menu.name}</h1>
     <p className="mt-4 text-sm text-[#f1e5da]">{[data.menu.location,data.menu.sales_mode==='event'&&data.menu.start&&data.menu.end?data.menu.start+' – '+data.menu.end:null].filter(Boolean).join(' · ')}</p>
     <p className="mt-6 inline-block rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">Browse our menu</p>
    </header>
    <section className="mt-8" aria-label="Browse products">
     <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-[#a97855]">Explore</p><h2 className="mt-2 text-2xl font-bold">Made for you</h2></div><label className="block w-full sm:w-72"><span className="sr-only">Search menu</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search the menu…" className="w-full rounded-xl border border-[#dfd0c2] bg-white px-4 py-3 outline-none focus:border-[#a97855]"/></label></div>
     {categories.length>1&&<nav className="mt-5 flex flex-wrap gap-2" aria-label="Menu categories">{categories.map(c=><button type="button" key={c} onClick={()=>setCategory(c)} aria-pressed={category===c} className={'rounded-full px-4 py-2 text-sm font-semibold '+(category===c?'bg-[#4a3026] text-white':'border border-[#dfd0c2] bg-white')}>{c}</button>)}</nav>}
     <div className="mt-6 grid gap-5 sm:grid-cols-2">{products.map(p=><article key={p.id} className="overflow-hidden rounded-3xl border border-[#eaded3] bg-white shadow-sm">
       {p.images[0]?<img src={p.images[0]} alt={p.name} className="h-56 w-full object-cover" loading="lazy"/>:<div className="flex h-36 items-center justify-center bg-[#f1e7dd] text-4xl" aria-hidden="true">☕</div>}
       <div className="p-6"><h3 className="text-xl font-bold">{p.name}</h3>{p.description&&<p className="mt-2 text-sm leading-6 text-[#75645a]">{p.description}</p>}
        <div className="mt-5 space-y-2 border-t border-[#f0e6dc] pt-4">{p.sizes.length?p.sizes.map(s=><div key={s.name} className="flex items-center justify-between gap-4 text-sm"><span>{s.name}</span><strong>{money(s.price)}</strong></div>):<p className="text-lg font-bold">{money(Number(p.price))}</p>}</div>
       </div></article>)}</div>
     {!products.length&&<p className="mt-6 rounded-2xl bg-white p-8 text-center text-[#75645a]">No matching products. Try another search.</p>}
    </section>
    <footer className="mt-10 rounded-2xl border border-[#eaded3] bg-white p-5 text-center text-sm text-[#75645a]">Ordering is not available from this menu yet. Please order directly with the business. No payment will be collected on this page.</footer>
   </>}
  </div>
 </main>;
}
