import {useEffect,useMemo,useState} from 'react';
type Product={id:string;name:string;description:string|null;price:number|null;sizes:{name:string;price:number}[];images:string[];category?:string|null};
type MenuData={business:string;menu:{name:string;location:string|null;sales_mode:string;start:string|null;end:string|null};products:Product[]};
const money=(n:number)=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
export default function PublicSalesMenu({menuId}:{menuId:string}){
 const [data,setData]=useState<MenuData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [search,setSearch]=useState(''),[category,setCategory]=useState('All');
 const [picks,setPicks]=useState<string[]>([]),[showPicks,setShowPicks]=useState(false);
 const togglePick=(id:string)=>setPicks(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
 useEffect(()=>{const ctrl=new AbortController();setLoading(true);setError('');
  void fetch('/api/business-products?mode=public-menu&id='+encodeURIComponent(menuId||''),{signal:ctrl.signal})
   .then(async res=>{const value=await res.json();if(!res.ok)throw new Error(value.error||'Menu unavailable');setData(value);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Menu unavailable');})
   .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return()=>ctrl.abort();
 },[menuId]);
 const categories=useMemo(()=>['All',...new Set((data?.products||[]).map(p=>p.category?.trim()).filter((v):v is string=>!!v))],[data]);
 const products=useMemo(()=>(data?.products||[]).filter(p=>(!showPicks||picks.includes(p.id))&&(category==='All'||p.category===category)&&(!search.trim()||(p.name+' '+(p.description||'')).toLowerCase().includes(search.toLowerCase().trim()))),[data,category,search,showPicks,picks]);
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
     <div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" aria-pressed={showPicks} onClick={()=>{setShowPicks(v=>!v);setCategory('All');setSearch('');}} className={'rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 '+(showPicks?'bg-[#4a3026] text-white':'border border-[#dfd0c2] bg-white')}>♥ My Picks ({picks.length})</button>{picks.length>0&&<span role="status" className="text-xs text-[#75645a]">Saved for this visit · show your picks at the counter</span>}</div>
     {categories.length>1&&!showPicks&&<nav className="mt-5 flex flex-wrap gap-2" aria-label="Menu categories">{categories.map(c=><button type="button" key={c} onClick={()=>setCategory(c)} aria-pressed={category===c} className={'rounded-full px-4 py-2 text-sm font-semibold '+(category===c?'bg-[#4a3026] text-white':'border border-[#dfd0c2] bg-white')}>{c}</button>)}</nav>}
     <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5">{products.map(p=><article key={p.id} className="relative overflow-hidden rounded-2xl border border-[#eaded3] bg-white shadow-sm">
       {p.images[0]?<img src={p.images[0]} alt={p.name} className="h-32 w-full object-cover sm:h-52" loading="lazy"/>:<div className="flex h-32 items-center justify-center bg-[#f1e7dd] text-4xl" aria-hidden="true">☕</div>}
       <button type="button" aria-label={(picks.includes(p.id)?'Remove ':'Add ')+p.name+(picks.includes(p.id)?' from':' to')+' My Picks'} aria-pressed={picks.includes(p.id)} onClick={()=>togglePick(p.id)} className={'absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-xl shadow transition active:scale-90 '+(picks.includes(p.id)?'bg-[#4a3026] text-white':'bg-white/95 text-[#4a3026]')}><span aria-hidden="true">{picks.includes(p.id)?'♥':'♡'}</span></button>
       <div className="p-3 sm:p-6"><h3 className="text-sm font-bold leading-snug sm:text-xl">{p.name}</h3>{p.description&&<p className="mt-2 text-xs leading-5 sm:text-sm sm:leading-6 text-[#75645a]">{p.description}</p>}
        <div className="mt-3 space-y-2 border-t border-[#f0e6dc] pt-3 sm:mt-5 sm:pt-4">{p.sizes.length?p.sizes.map(s=><div key={s.name} className="flex items-center justify-between gap-2 text-xs sm:text-sm"><span>{s.name}</span><strong>{money(s.price)}</strong></div>):<p className="text-sm font-bold sm:text-lg">{money(Number(p.price))}</p>}</div>
       </div></article>)}</div>
     {!products.length&&<p className="mt-6 rounded-2xl bg-white p-8 text-center text-[#75645a]">No matching products. Try another search or category.</p>}
    </section>
    <footer className="mt-10 rounded-2xl border border-[#eaded3] bg-white p-5 text-center text-sm text-[#75645a]">Ready to order? Visit the counter and show our team your picks. Hearts only save a shortlist on this page — they do not place an order or collect payment.</footer>
   </>}
  </div>
 </main>;
}
