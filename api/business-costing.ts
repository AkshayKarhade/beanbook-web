import { createClient } from '@supabase/supabase-js';

const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length <= max ? v.trim() : null;
const number = (v: unknown, min: number, max: number, decimals: number) => {
  if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && !v.trim())) return null;
  const n = Number(v), factor = 10 ** decimals;
  return Number.isFinite(n) && n >= min && n <= max && Math.abs(n*factor-Math.round(n*factor)) < 0.01 ? n : null;
};
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function date(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v+'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===v && v <= today();
}

export default async function businessCosting(request: Request) {
  if (!['GET','POST'].includes(request.method)) return json({error:'Method not allowed.'},405);
  if (request.headers.get('origin') && request.headers.get('origin')!==new URL(request.url).origin) return json({error:'Cross-origin request blocked.'},403);
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({error:'Sign in to continue.'},401);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return json({error:'Costing is not configured.'},503);
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    const {data:identity,error:authError}=await db.auth.getUser(token);
    if(authError || !identity.user || identity.user.is_anonymous) return json({error:'Session expired.'},401);
    const {data:member,error:memberError}=await db.from('admin_users').select('brand_id,role').eq('supabase_user_id',identity.user.id).maybeSingle();
    if(memberError) throw memberError;
    if(!member || member.role!=='owner') return json({error:'Business owner access required.'},403);
    const brand=member.brand_id as string;
    if(request.method==='GET'){
      const results=await Promise.all([
        db.from('ingredients').select('id,name,base_unit,is_active').eq('brand_id',brand).order('name'),
        db.from('ingredient_purchases').select('id,ingredient_id,purchased_on,quantity,total_cost,supplier').eq('brand_id',brand).order('purchased_on',{ascending:false}).order('created_at',{ascending:false}).limit(200),
        db.from('products').select('id,name,price,is_active').eq('brand_id',brand).order('name'),
        db.from('product_sizes').select('product_id,name,price').eq('brand_id',brand),
        db.from('product_addons').select('id,name,is_active').eq('brand_id',brand).order('name'),
        db.from('product_addon_prices').select('addon_id,size_name,price').eq('brand_id',brand),
        db.rpc('beanbook_current_recipe_costs',{p_brand_id:brand,p_as_of:today()}),
        db.from('costing_recipes').select('id,product_id,addon_id,size_name,yield_quantity,costing_recipe_items(ingredient_id,quantity)').eq('brand_id',brand).order('effective_at',{ascending:false}).limit(200),
        db.from('business_expenses').select('id,incurred_on,category,amount,description').eq('brand_id',brand).order('incurred_on',{ascending:false}).limit(200),
        db.from('inventory_units').select('id,name,track_inventory').eq('brand_id',brand).eq('track_inventory',true),
        db.from('inventory_balances').select('inventory_unit_id,product_id,quantity_on_hand,inventory_units!inner(brand_id)').eq('inventory_units.brand_id',brand),
        db.from('inventory_stock_counts').select('id,inventory_unit_id,product_id,expected_quantity,counted_quantity,reason,notes,counted_at').eq('brand_id',brand).order('counted_at',{ascending:false}).limit(200)
      ]);
      for(const r of results) if(r.error) throw r.error;
      const keys=['ingredients','purchases','products','sizes','addons','addonPrices','costs','recipes','expenses','units','balances','counts'];
      return json(Object.fromEntries(results.map((r,i)=>[keys[i],r.data??[]])));
    }
    if(!(request.headers.get('content-type')||'').includes('application/json')) return json({error:'JSON required.'},415);
    const raw=await request.text();
    if(raw.length>36000) return json({error:'Request too large.'},413);
    let b: Record<string,unknown>;
    try {const v:unknown=JSON.parse(raw);if(!v || typeof v!=='object'||Array.isArray(v)) throw new Error(); b=v as Record<string,unknown>;} catch {return json({error:'Invalid JSON.'},400);}
    if(b.action==='ingredient'){
      const name=str(b.name,120);
      if(!name || !['g','ml','piece'].includes(String(b.unit))) return json({error:'Enter ingredient name and base unit.'},400);
      const {error}=await db.from('ingredients').insert({brand_id:brand,name,base_unit:b.unit});if(error)throw error;
    } else if(b.action==='purchase'){
      const quantity=number(b.quantity,0.000001,100000000,6),cost=number(b.cost,0,100000000,2),supplier=str(b.supplier??'',120);
      if(!uuid(b.ingredientId)||!date(b.date)||quantity===null||cost===null||supplier===null) return json({error:'Enter a valid ingredient, date, quantity and total cost.'},400);
      const {error}=await db.from('ingredient_purchases').insert({brand_id:brand,ingredient_id:b.ingredientId,purchased_on:b.date,quantity,total_cost:cost,supplier:supplier||null});if(error)throw error;
    } else if(b.action==='recipe'){
      const size=str(b.size??'',120),yieldQty=number(b.yield,0.0001,1000000,4);
      const product=uuid(b.productId)?b.productId:null,addon=uuid(b.addonId)?b.addonId:null;
      if((!product===!addon)||size===null||yieldQty===null||!Array.isArray(b.items)||b.items.length<1||b.items.length>100) return json({error:'Enter a recipe target, yield and ingredient lines.'},400);
      const items=b.items.map((v:unknown)=>{const x=v&&typeof v==='object'?v as Record<string,unknown>:{};return {ingredient_id:uuid(x.ingredient_id)?x.ingredient_id:null,quantity:number(x.quantity,0.000001,100000000,6)};});
      if(items.some(x=>x.ingredient_id===null||x.quantity===null)||new Set(items.map(x=>x.ingredient_id)).size!==items.length) return json({error:'Use distinct ingredients with positive quantities.'},400);
      const {error}=await db.rpc('beanbook_save_costing_recipe',{p_brand_id:brand,p_product_id:product,p_addon_id:addon,p_size_name:size,p_yield:yieldQty,p_items:items});if(error)throw error;
    } else if(b.action==='expense'){
      const amount=number(b.amount,0.01,100000000,2),description=str(b.description,500);
      if(amount===null||!description||!date(b.date)||!['rent','utilities','labour','commission','payment_fee','marketing','transport','other'].includes(String(b.category))) return json({error:'Enter valid expense details.'},400);
      const {error}=await db.from('business_expenses').insert({brand_id:brand,incurred_on:b.date,category:b.category,amount,description});if(error)throw error;
    } else if(b.action==='count'){
      const quantity=number(b.quantity,0,2147483647,0),notes=str(b.notes??'',500);
      if(quantity===null||notes===null||!uuid(b.unitId)||!uuid(b.productId)||!['unknown','wastage','personal_consumption','unpaid_removal','external_sale','count_correction','other'].includes(String(b.reason))) return json({error:'Enter valid stock count details.'},400);
      const {data:balance,error}=await db.from('inventory_balances').select('quantity_on_hand,inventory_units!inner(brand_id,track_inventory)').eq('inventory_unit_id',b.unitId).eq('product_id',b.productId).eq('inventory_units.brand_id',brand).eq('inventory_units.track_inventory',true).maybeSingle();
      if(error)throw error;if(!balance)return json({error:'Tracked stock not found.'},404);
      const {error:saveError}=await db.from('inventory_stock_counts').insert({brand_id:brand,inventory_unit_id:b.unitId,product_id:b.productId,expected_quantity:balance.quantity_on_hand,counted_quantity:quantity,reason:b.reason,notes:notes||null});if(saveError)throw saveError;
    } else return json({error:'Unknown action.'},400);
    return json({ok:true},201);
  } catch(error) {
    const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
    if(['23503','23505','23514','22023','22003','22P02'].includes(code)) return json({error:'Invalid or duplicate entry. Check the selected business records and values.'},400);
    console.error('Costing request failed',code);
    return json({error:'Costing service unavailable. Please try again.'},503);
  }
}
