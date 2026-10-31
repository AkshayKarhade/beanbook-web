import {createClient} from '@supabase/supabase-js';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export default async function salesMenus(req:Request){
 if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Cross-origin request blocked'},403);
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)return json({error:'Menus backend not configured'},503);
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)return json({error:'Sign in required'},401);
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:identity,error:authError}=await db.auth.getUser(token);
  if(authError||!identity.user||identity.user.is_anonymous)return json({error:'Session expired'},401);
  const {data:membership,error:memberError}=await db.from('admin_users').select('brand_id,role').eq('supabase_user_id',identity.user.id).maybeSingle();
  if(memberError)throw memberError;
  if(!membership||membership.role!=='owner')return json({error:'Business owner access required'},403);
  const brandId=membership.brand_id as string;
  if(req.method==='GET'){
   const [events,assignments,sizes,overrides,products,brand]=await Promise.all([
    db.from('events').select('id,name,slug,sales_mode,status,event_start_date,event_end_date,location,ordering_closes_at').eq('brand_id',brandId).in('sales_mode',['regular','event']).order('created_at',{ascending:false}),
    db.from('event_products').select('id,event_id,product_id,display_order,price_override,inventory_tracking,events!inner(brand_id,sales_mode)').eq('events.brand_id',brandId).in('events.sales_mode',['regular','event']).order('display_order'),
    db.from('product_sizes').select('product_id,name,price,display_order').eq('brand_id',brandId),
    db.from('event_product_size_prices').select('event_product_id,size_name,price').eq('brand_id',brandId),
    db.from('products').select('id,name,price,is_active').eq('brand_id',brandId).order('name'),
    db.from('brands').select('name').eq('id',brandId).single()
   ]);
   for(const r of [events,assignments,sizes,overrides,products,brand])if(r.error)throw r.error;
   return json({businessName:brand.data.name,menus:events.data||[],items:(assignments.data||[]).map(({events:ignored,...item})=>{void ignored;return item;}),sizes:sizes.data||[],overrides:overrides.data||[],products:products.data||[]});
  }
  if(!(req.headers.get('content-type')||'').includes('application/json'))return json({error:'JSON required'},415);
  const raw=await req.text();if(raw.length>26000)return json({error:'Request too large'},413);
  const body=JSON.parse(raw) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request'},400);
  if(body.action==='createDraft'){
   const kind=body.kind;
   if(kind!=='regular'&&kind!=='event')return json({error:'Invalid selling mode'},400);
   const name=typeof body.name==='string'?body.name.trim():'';
   if(name.length<2||name.length>120)return json({error:'Name must be 2–120 characters'},400);
   const location=typeof body.location==='string'?body.location.trim():'';
   if(location.length>300)return json({error:'Location is too long'},400);
   const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;
   const start=date(body.startDate),end=date(body.endDate);
   if(kind==='event'&&(!start||!end||end<start))return json({error:'Choose valid event start/end dates'},400);
   const slug=(kind==='regular'?'regular-menu':name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50))+'-'+crypto.randomUUID().slice(0,8);
   const {data,error}=await db.from('events').insert({brand_id:brandId,sales_mode:kind,status:'draft',name,slug,location:location||null,event_start_date:start,event_end_date:end}).select('id').single();
   if(error)throw error;return json({ok:true,menuId:data.id},201);
  }
  if(body.action==='publishMenu'){
   if(!uuid(body.menuId))return json({error:'Invalid menu'},400);
   const {data,error}=await db.rpc('beanbook_publish_sales_menu',{p_brand_id:brandId,p_menu_id:body.menuId});
   if(error){if(error.code==='22023')return json({error:error.message},400);throw error;}
   return json({ok:true,menuId:data});
  }
  if(body.action==='saveDraftItems'){
   if(!uuid(body.menuId)||!Array.isArray(body.items)||body.items.length>80)return json({error:'Invalid menu configuration'},400);
   const items=body.items as Record<string,unknown>[];
   for(const item of items){
    if(!item||!uuid(item.product_id)||typeof item.track_inventory!=='boolean'||(item.price_override!==null&&item.price_override!==undefined&&(typeof item.price_override!=='number'||!Number.isFinite(item.price_override)))||!item.size_overrides||typeof item.size_overrides!=='object'||Array.isArray(item.size_overrides))return json({error:'Invalid item configuration'},400);
   }
   const {data,error}=await db.rpc('beanbook_save_draft_menu_items',{p_brand_id:brandId,p_event_id:body.menuId,p_items:items});
   if(error){if(error.code==='22023')return json({error:error.message},400);throw error;}
   return json({ok:true,count:data});
  }
  return json({error:'Unknown action'},400);
 }catch(err){console.error('Sales menu request failed',err);return json({error:'Could not manage menus right now'},500);}
}
