import { createClient } from '@supabase/supabase-js';
type Obj = Record<string,unknown>;
const json=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}});
const id=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v);
const money=(v:unknown)=>typeof v==='number'||typeof v==='string'?Number(v):NaN;
const validPrice=(n:number,zero=false)=>Number.isFinite(n)&&(zero?n>=0:n>0)&&n<=100000&&Math.abs(n*100-Math.round(n*100))<0.00001;
const title=(v:unknown,max=120)=>typeof v==='string'?v.trim().slice(0,max):'';
export default async function options(req:Request){
 if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Origin denied'},403);
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)return json({error:'Options service not configured'},503);
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)return json({error:'Sign in required'},401);
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:identity,error:authError}=await db.auth.getUser(token);
  if(authError||!identity.user||identity.user.is_anonymous)return json({error:'Session expired'},401);
  const {data:member,error:memError}=await db.from('admin_users').select('brand_id,role').eq('supabase_user_id',identity.user.id).maybeSingle();
  if(memError)throw memError;
  if(!member||member.role!=='owner')return json({error:'Business owner required'},403);
  const brand=member.brand_id;
  if(req.method==='GET'){
   const [sizes,addons,prices,links]=await Promise.all([
    db.from('product_sizes').select('id,product_id,name,price,display_order').eq('brand_id',brand).order('display_order'),
    db.from('product_addons').select('id,name,description,is_active').eq('brand_id',brand).order('name'),
    db.from('product_addon_prices').select('addon_id,size_name,price').eq('brand_id',brand),
    db.from('product_allowed_addons').select('product_id,addon_id').eq('brand_id',brand)]);
   const failure=[sizes,addons,prices,links].find(x=>x.error);if(failure?.error)throw failure.error;
   return json({sizes:sizes.data,addons:addons.data,prices:prices.data,links:links.data});
  }
  if(!(req.headers.get('content-type')||'').includes('application/json'))return json({error:'JSON expected'},415);
  const raw=await req.text();if(raw.length>30000)return json({error:'Too large'},413);
  const body=JSON.parse(raw) as Obj;
  if(body.action==='saveSizes'){
   if(!id(body.productId)||!Array.isArray(body.sizes)||body.sizes.length>12)return json({error:'Invalid product sizes'},400);
   const {data:product}=await db.from('products').select('id').eq('id',body.productId).eq('brand_id',brand).maybeSingle();
   if(!product)return json({error:'Product not found'},404);
   const rows=[] as {brand_id:string;product_id:string;name:string;price:number;display_order:number}[];
   const seen=new Set<string>();
   for(const [i,v] of body.sizes.entries()){
    if(!v||typeof v!=='object')return json({error:'Invalid size'},400);
    const row=v as Obj,n=title(row.name,60),price=money(row.price);
    if(!n||seen.has(n.toLowerCase())||!validPrice(price))return json({error:'Each size needs a unique name and a valid price'},400);
    seen.add(n.toLowerCase());rows.push({brand_id:brand,product_id:product.id,name:n,price,display_order:i});
   }
   // Validate before replacing; avoid partial deletion if a write fails.
   if(rows.length){
    const {error:upsertError}=await db.from('product_sizes').upsert(rows,{onConflict:'product_id,name'});
    if(upsertError)throw upsertError;
   }
   const {data:existing,error:readErr}=await db.from('product_sizes').select('id,name').eq('brand_id',brand).eq('product_id',product.id);
   if(readErr)throw readErr;
   const removed=(existing||[]).filter(r=>!seen.has(r.name.toLowerCase())).map(r=>r.id);
   if(removed.length){const {error:deleteError}=await db.from('product_sizes').delete().in('id',removed).eq('brand_id',brand);if(deleteError)throw deleteError;}
   return json({ok:true});
  }
  if(body.action==='saveAddon'){
   const name=title(body.name),description=title(body.description,500);
   if(name.length<2||!Array.isArray(body.prices)||body.prices.length>12)return json({error:'Invalid add-on'},400);
   const prices=[] as {brand_id:string;addon_id:string;size_name:string;price:number}[];
   const seen=new Set<string>();
   for(const v of body.prices){
    if(!v||typeof v!=='object')return json({error:'Invalid add-on price'},400);
    const row=v as Obj,n=title(row.size_name,60),price=money(row.price);
    if(!n||seen.has(n.toLowerCase())||!validPrice(price,true))return json({error:'Each add-on size needs a unique name and valid price'},400);
    seen.add(n.toLowerCase());prices.push({brand_id:brand,addon_id:'',size_name:n,price});
   }
   let addonId=id(body.addonId)?body.addonId:null;
   if(addonId){
    const {data,error}=await db.from('product_addons').update({name,description:description||null}).eq('id',addonId).eq('brand_id',brand).select('id').maybeSingle();
    if(error)throw error;if(!data)return json({error:'Add-on not found'},404);
   }else{
    const {data,error}=await db.from('product_addons').insert({brand_id:brand,name,description:description||null,is_active:true}).select('id').single();
    if(error)throw error;addonId=data.id;
   }
   if(prices.length){const {error}=await db.from('product_addon_prices').upsert(prices.map(p=>({...p,addon_id:addonId!})),{onConflict:'addon_id,size_name'});if(error)throw error;}
   const {data:existing,error:readError}=await db.from('product_addon_prices').select('id,size_name').eq('addon_id',addonId).eq('brand_id',brand);
   if(readError)throw readError;
   const obsolete=(existing||[]).filter(p=>!seen.has(p.size_name.toLowerCase())).map(p=>p.id);
   if(obsolete.length){const {error}=await db.from('product_addon_prices').delete().eq('brand_id',brand).in('id',obsolete);if(error)throw error;}
   return json({ok:true,addonId});
  }
  if(body.action==='setAddonActive'){
   if(!id(body.addonId)||typeof body.active!=='boolean')return json({error:'Invalid add-on'},400);
   const {data,error}=await db.from('product_addons').update({is_active:body.active}).eq('id',body.addonId).eq('brand_id',brand).select('id').maybeSingle();
   if(error)throw error;return data?json({ok:true}):json({error:'Add-on not found'},404);
  }
  if(body.action==='setProductAddons'){
   if(!id(body.productId)||!Array.isArray(body.addonIds)||body.addonIds.length>50||body.addonIds.some(x=>!id(x)))return json({error:'Invalid selection'},400);
   const ids=[...new Set(body.addonIds as string[])];
   const {data:product}=await db.from('products').select('id').eq('id',body.productId).eq('brand_id',brand).maybeSingle();
   if(!product)return json({error:'Product not found'},404);
   if(ids.length){const {data:valid,error}=await db.from('product_addons').select('id').eq('brand_id',brand).in('id',ids);
    if(error)throw error;if(valid?.length!==ids.length)return json({error:'Unknown add-on'},400);
    const {error:insertError}=await db.from('product_allowed_addons').upsert(ids.map(addon_id=>({product_id:product.id,addon_id,brand_id:brand})),{onConflict:'product_id,addon_id'});if(insertError)throw insertError;}
   const {data:assigned,error:readError}=await db.from('product_allowed_addons').select('addon_id').eq('brand_id',brand).eq('product_id',product.id);
   if(readError)throw readError;
   const gone=(assigned||[]).filter(a=>!ids.includes(a.addon_id)).map(a=>a.addon_id);
   if(gone.length){const {error}=await db.from('product_allowed_addons').delete().eq('product_id',product.id).eq('brand_id',brand).in('addon_id',gone);if(error)throw error;}
   return json({ok:true});
  }
  return json({error:'Unsupported action'},400);
 }catch(e){console.error('Business options error:',e);return json({error:'Unable to manage sizes and add-ons'},500);}
}
