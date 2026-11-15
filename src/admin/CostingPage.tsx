import { useCallback, useEffect, useState } from 'react';
import { adminSupabase } from './client';

type Ingredient={id:string;name:string;base_unit:string;is_active:boolean};
type Product={id:string;name:string;price:number;is_active:boolean};
type Size={product_id:string;name:string;price:number};
type AddonPrice={addon_id:string;size_name:string;price:number};
type Cost={recipe_id:string;product_id:string|null;addon_id:string|null;size_name:string;estimated_unit_cost:number|null;missing_cost_count:number;yield_quantity:number};
type Recipe={id:string;product_id:string|null;addon_id:string|null;size_name:string;yield_quantity:number;costing_recipe_items:{ingredient_id:string;quantity:number}[]};
type Purchase={id:string;ingredient_id:string;purchased_on:string;quantity:number;total_cost:number;supplier:string|null};
type Expense={id:string;incurred_on:string;category:string;amount:number;description:string};
type StockCount={id:string;inventory_unit_id:string;product_id:string;expected_quantity:number;counted_quantity:number;reason:string;counted_at:string};
type Data={ingredients:Ingredient[];products:Product[];sizes:Size[];addons:Product[];addonPrices:AddonPrice[];costs:Cost[];recipes:Recipe[];purchases:Purchase[];expenses:Expense[];units:{id:string;name:string}[];balances:{inventory_unit_id:string;product_id:string;quantity_on_hand:number}[];counts:StockCount[]};
const empty:Data={ingredients:[],products:[],sizes:[],addons:[],addonPrices:[],costs:[],recipes:[],purchases:[],expenses:[],units:[],balances:[],counts:[]};
const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n);
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const field='w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm';
const button='rounded-xl bg-[#1b2822] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const panel='space-y-4 rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sm';
const categories=['rent','utilities','labour','commission','payment_fee','marketing','transport','other'];
const reasons=['unknown','wastage','personal_consumption','unpaid_removal','external_sale','count_correction','other'];
const label=(s:string)=>s.replaceAll('_',' ');
export default function CostingPage(){
  const [data,setData]=useState<Data>(empty),[tab,setTab]=useState('ingredients'),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [name,setName]=useState(''),[unit,setUnit]=useState('g'),[ingredient,setIngredient]=useState(''),[purchaseDate,setPurchaseDate]=useState(date),[quantity,setQuantity]=useState(''),[cost,setCost]=useState(''),[supplier,setSupplier]=useState('');
  const [kind,setKind]=useState('product'),[target,setTarget]=useState(''),[size,setSize]=useState(''),[yieldQty,setYield]=useState('1'),[lines,setLines]=useState([{ingredient_id:'',quantity:''}]);
  const [expenseDate,setExpenseDate]=useState(date),[category,setCategory]=useState('rent'),[amount,setAmount]=useState(''),[description,setDescription]=useState('');
  const [location,setLocation]=useState(''),[stockProduct,setStockProduct]=useState(''),[count,setCount]=useState(''),[reason,setReason]=useState('unknown'),[notes,setNotes]=useState('');
  const request=useCallback(async(payload?:Record<string,unknown>)=>{
    if(!adminSupabase)throw new Error('Business connection unavailable.');
    const {data:auth}=await adminSupabase.auth.getSession();
    if(!auth.session?.access_token)throw new Error('Please sign in again.');
    const response=await fetch('/api/business-products?mode=costing',{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+auth.session.access_token,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
    if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Costing service unavailable.');
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||'Request failed.');
    return body;
  },[]);
  const refresh=useCallback(async()=>{setData(await request() as Data);},[request]);
  useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:'Unable to load costing')).finally(()=>setLoading(false));},[refresh]);
  async function save(payload:Record<string,unknown>,reset:()=>void){
    setBusy(true);setError('');setNotice('');
    try{await request(payload);reset();setNotice('Saved successfully.');try{await refresh();}catch{setError('Saved, but refresh failed. Reload before continuing.');}}
    catch(e){setError(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}
  }
  const ingredientName=(id:string)=>data.ingredients.find(x=>x.id===id)?.name||id;
  const targetName=(p:string|null,a:string|null)=>p?data.products.find(x=>x.id===p)?.name||'Archived product':data.addons.find(x=>x.id===a)?.name||'Archived add-on';
  const sizes=kind==='product'?data.sizes.filter(x=>x.product_id===target).map(x=>x.name):data.addonPrices.filter(x=>x.addon_id===target).map(x=>x.size_name||'');
  const tracked=data.balances.filter(x=>x.inventory_unit_id===location);
  const recipe=data.recipes.find(x=>(kind==='product'?x.product_id===target:x.addon_id===target)&&x.size_name===size);
  const stock=tracked.find(x=>x.product_id===stockProduct);
  const activeIngredients=data.ingredients.filter(x=>x.is_active);
  if(loading)return <p role="status">Loading costing…</p>;
  return <div className="space-y-5">
    <p className="text-sm text-zinc-600">Record ingredients, purchases, recipes and expenses. Recipe costs use the latest documented purchase price, not realized historical profit.</p>
    <div className="flex flex-wrap gap-2">{['ingredients','recipes','expenses','stock counts'].map(t=><button key={t} type="button" disabled={busy} onClick={()=>setTab(t)} className={'rounded-xl px-4 py-2 text-sm font-medium capitalize '+(tab===t?'bg-[#1b2822] text-white':'border bg-white')}>{t}</button>)}<button type="button" disabled={busy} className="rounded-xl border bg-white px-4 py-2 text-sm" onClick={()=>{setBusy(true);setError('');void refresh().catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Refresh</button></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {tab==='ingredients'&&<>
      <form className={panel} onSubmit={e=>{e.preventDefault();void save({action:'ingredient',name,unit},()=>setName(''));}}>
        <h3 className="text-lg font-semibold">Add ingredient</h3>
        <div className="grid gap-3 sm:grid-cols-2"><label>Ingredient name<input className={field} required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Coffee beans"/></label><label>Base unit<select className={field} value={unit} onChange={e=>setUnit(e.target.value)}><option value="g">Grams (g)</option><option value="ml">Millilitres (ml)</option><option value="piece">Pieces</option></select></label></div>
        <button className={button} disabled={busy}>Add ingredient</button>
      </form>
      <form className={panel} onSubmit={e=>{e.preventDefault();void save({action:'purchase',ingredientId:ingredient,date:purchaseDate,quantity,cost,supplier},()=>{setQuantity('');setCost('');setSupplier('');});}}>
        <h3 className="text-lg font-semibold">Record purchase</h3>
        <div className="grid gap-3 sm:grid-cols-2"><label>Ingredient<select required className={field} value={ingredient} onChange={e=>setIngredient(e.target.value)}><option value="">Select ingredient</option>{activeIngredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}</select></label><label>Purchase date<input type="date" required max={date()} className={field} value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)}/></label><label>Quantity ({data.ingredients.find(i=>i.id===ingredient)?.base_unit||'base units'})<input required type="number" min="0.000001" step="0.000001" className={field} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label>Total cost (₹)<input required type="number" min="0" step="0.01" className={field} value={cost} onChange={e=>setCost(e.target.value)}/></label><label>Supplier (optional)<input className={field} maxLength={120} value={supplier} onChange={e=>setSupplier(e.target.value)}/></label></div>
        <button className={button} disabled={busy||!activeIngredients.length}>Save purchase</button>
      </form>
      <div className={panel}><h3 className="text-lg font-semibold">Ingredients ({data.ingredients.length})</h3>{data.ingredients.map(i=><div key={i.id} className="border-t py-2 text-sm">{i.name} · {i.base_unit}</div>)}<h3 className="text-lg font-semibold">Recent purchases</h3>{data.purchases.length?data.purchases.map(p=><div key={p.id} className="border-t py-2 text-sm">{p.purchased_on} · {ingredientName(p.ingredient_id)} · {p.quantity} · {money(p.total_cost)}{p.supplier?' · '+p.supplier:''}</div>):<p className="text-sm text-zinc-500">No purchases recorded.</p>}</div>
    </>}
    {tab==='recipes'&&<>
      <form className={panel} onSubmit={e=>{e.preventDefault();void save({action:'recipe',productId:kind==='product'?target:null,addonId:kind==='addon'?target:null,size,yield:yieldQty,items:lines},()=>{});}}>
        <h3 className="text-lg font-semibold">Save recipe version</h3>
        <p className="text-sm text-zinc-500">Use ingredient quantities for the whole batch, including packaging. Yield is the number of saleable portions. A new version preserves earlier recipes.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Recipe type<select className={field} value={kind} onChange={e=>{setKind(e.target.value);setTarget('');setSize('');}}><option value="product">Product</option><option value="addon">Add-on (incremental)</option></select></label>
          <label>Product or add-on<select required className={field} value={target} onChange={e=>{setTarget(e.target.value);setSize('');}}><option value="">Select</option>{(kind==='product'?data.products:data.addons).filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>Size<select className={field} required={sizes.length>0&&!sizes.includes('')} value={size} onChange={e=>setSize(e.target.value)}><option value="">{sizes.length&&!sizes.includes('')?'Select size':'Standard'}</option>{sizes.filter(Boolean).map(s=><option key={s} value={s}>{s}</option>)}</select></label>
          <label>Batch yield (saleable portions)<input type="number" required min="0.0001" step="0.0001" className={field} value={yieldQty} onChange={e=>setYield(e.target.value)}/></label>
        </div>
        {recipe&&<button type="button" className="text-sm font-semibold underline" onClick={()=>{setYield(String(recipe.yield_quantity));setLines(recipe.costing_recipe_items.map(x=>({ingredient_id:x.ingredient_id,quantity:String(x.quantity)})));}}>Load last saved recipe</button>}
        {lines.map((line,i)=><div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_auto]"><label>Ingredient {i+1}<select required className={field} value={line.ingredient_id} onChange={e=>setLines(old=>old.map((x,j)=>j===i?{...x,ingredient_id:e.target.value}:x))}><option value="">Select</option>{activeIngredients.map(x=><option key={x.id} value={x.id}>{x.name} ({x.base_unit})</option>)}</select></label><label>Quantity<input required type="number" min="0.000001" step="0.000001" className={field} value={line.quantity} onChange={e=>setLines(old=>old.map((x,j)=>j===i?{...x,quantity:e.target.value}:x))}/></label><button type="button" className="rounded-xl border px-3 py-2 text-sm" disabled={lines.length===1} onClick={()=>setLines(old=>old.filter((_,j)=>j!==i))}>Remove</button></div>)}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||lines.length>=100} className="rounded-xl border px-4 py-2 text-sm" onClick={()=>setLines(old=>[...old,{ingredient_id:'',quantity:''}])}>Add ingredient line</button><button className={button} disabled={busy||!activeIngredients.length}>Save recipe</button></div>
      </form>
      <div className={panel}><h3 className="text-lg font-semibold">Estimated current recipe costs</h3>{data.costs.length?data.costs.map(c=><div key={c.recipe_id} className="flex flex-wrap justify-between gap-2 border-t py-3 text-sm"><span>{targetName(c.product_id,c.addon_id)} {c.size_name&&'· '+c.size_name}</span><strong>{c.estimated_unit_cost===null?'Missing '+c.missing_cost_count+' ingredient costs':money(c.estimated_unit_cost)+' / portion'}</strong></div>):<p className="text-sm text-zinc-500">No recipes saved yet.</p>}</div>
    </>}
    {tab==='expenses'&&<>
      <form className={panel} onSubmit={e=>{e.preventDefault();void save({action:'expense',date:expenseDate,category,amount,description},()=>{setAmount('');setDescription('');});}}><h3 className="text-lg font-semibold">Record expense</h3><p className="text-sm text-zinc-500">Do not enter ingredient purchases here; record them under Ingredients to prevent double counting.</p><div className="grid gap-3 sm:grid-cols-2"><label>Date<input required type="date" max={date()} className={field} value={expenseDate} onChange={e=>setExpenseDate(e.target.value)}/></label><label>Category<select className={field} value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c} value={c}>{label(c)}</option>)}</select></label><label>Amount (₹)<input required type="number" min="0.01" step="0.01" className={field} value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Description<input required maxLength={500} className={field} value={description} onChange={e=>setDescription(e.target.value)}/></label></div><button className={button} disabled={busy}>Save expense</button></form>
      <div className={panel}><h3 className="text-lg font-semibold">Recent expenses</h3>{data.expenses.length?data.expenses.map(x=><div key={x.id} className="border-t py-2 text-sm">{x.incurred_on} · {label(x.category)} · {x.description} · {money(x.amount)}</div>):<p className="text-sm text-zinc-500">No expenses recorded.</p>}</div>
    </>}
    {tab==='stock counts'&&<>
      <form className={panel} onSubmit={e=>{e.preventDefault();void save({action:'count',unitId:location,productId:stockProduct,quantity:count,reason,notes},()=>{setCount('');setNotes('');});}}><h3 className="text-lg font-semibold">Record physical stock count</h3><p className="text-sm text-zinc-500">This records a discrepancy for investigation. It does not change available stock or recognize a sale.</p><div className="grid gap-3 sm:grid-cols-2"><label>Location<select required className={field} value={location} onChange={e=>{setLocation(e.target.value);setStockProduct('');}}><option value="">Select location</option>{data.units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>Product<select required className={field} value={stockProduct} onChange={e=>setStockProduct(e.target.value)}><option value="">Select product</option>{tracked.map(b=><option key={b.product_id} value={b.product_id}>{targetName(b.product_id,null)}</option>)}</select></label><label>Counted quantity<input required type="number" min="0" step="1" className={field} value={count} onChange={e=>setCount(e.target.value)}/></label><label>Possible reason<select className={field} value={reason} onChange={e=>setReason(e.target.value)}>{reasons.map(r=><option key={r} value={r}>{label(r)}</option>)}</select></label><label>Notes<input className={field} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)}/></label></div>{stock&&<p className="text-sm">Last loaded expected stock: {stock.quantity_on_hand}. The server checks the live balance when saving.</p>}<button className={button} disabled={busy||!stock}>Record count</button></form>
      <div className={panel}><h3 className="text-lg font-semibold">Recent stock observations</h3>{data.counts.length?data.counts.map(c=><div key={c.id} className="border-t py-2 text-sm">{targetName(c.product_id,null)} · {data.units.find(u=>u.id===c.inventory_unit_id)?.name||'Location'} · expected {c.expected_quantity}, counted {c.counted_quantity}, difference {c.counted_quantity-c.expected_quantity} · {label(c.reason)}</div>):<p className="text-sm text-zinc-500">No stock counts recorded.</p>}</div>
    </>}
  </div>;
}
