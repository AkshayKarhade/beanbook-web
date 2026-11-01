import {createClient} from '@supabase/supabase-js';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
type Item={quantity:number;size_name:string|null;products:{name:string}|{name:string}[]|null};
type Order={id:string;order_number:string;created_at:string;total_amount:number|string;payment_status:string;order_items:Item[]};
const productName=(p:Item['products'])=>(Array.isArray(p)?p[0]?.name:p?.name)||'Unknown product';
type SummaryRow={customer_id:string;customer_name:string;phone:string;lifetime_value:number|string;order_count:number|string;latest_order_at:string|null};

export default async function businessCustomers(req:Request){
 if(req.method!=='GET'&&req.method!=='PATCH')return json({error:'Method not allowed'},405);
 if(req.method==='PATCH'&&req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Cross-origin request blocked'},403);
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)return json({error:'Customer service unavailable'},503);
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)return json({error:'Sign in required'},401);
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user||auth.user.is_anonymous)return json({error:'Session expired'},401);
  const {data:membership,error:membershipError}=await db.from('admin_users').select('brand_id,role').eq('supabase_user_id',auth.user.id).maybeSingle();
  if(membershipError)throw membershipError;
  if(!membership||!['owner','staff'].includes(membership.role))return json({error:'Business access required'},403);

  if(req.method==='GET'){
   const id=new URL(req.url).searchParams.get('id');
   if(id!==null){
    if(!uuid(id))return json({error:'Invalid customer ID'},400);
    const {data:customer,error:ce}=await db.from('customers').select('created_at').eq('id',id).eq('brand_id',membership.brand_id).maybeSingle();
    if(ce)throw ce;
    if(!customer)return json({error:'Customer not found'},404);
    const orders=()=>db.from('orders').eq('brand_id',membership.brand_id).eq('customer_id',id);
    const [first,paid,recent,products]=await Promise.all([
     orders().select('created_at').order('created_at',{ascending:true}).limit(1).maybeSingle(),
     orders().select('id',{count:'exact',head:true}).eq('payment_status','paid'),
     orders().select('id,order_number,created_at,total_amount,payment_status,order_items(quantity,size_name,products(name))').order('created_at',{ascending:false}).limit(5),
     orders().select('order_items(quantity,size_name,products(name))').eq('payment_status','paid').order('created_at',{ascending:false}).limit(50)
    ]);
    for(const r of [first,paid,recent,products])if(r.error)throw r.error;
    const counts=new Map<string,number>();
    for(const o of (products.data||[]) as {order_items:Item[]}[])for(const item of o.order_items||[]){
     const name=productName(item.products);
     if(name!=='Unknown product')counts.set(name,(counts.get(name)||0)+Number(item.quantity||0));
    }
    const top=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
    return json({insights:{
     customerSince:customer.created_at,firstOrderAt:first.data?.created_at||null,paidOrderCount:paid.count||0,
     topProduct:top?{name:top[0],quantity:top[1]}:null,topProductSampleSize:(products.data||[]).length,
     recentOrders:((recent.data||[]) as Order[]).map(o=>({
      id:o.id,number:o.order_number,createdAt:o.created_at,amount:Number(o.total_amount),paymentStatus:o.payment_status,
      items:(o.order_items||[]).map(i=>({name:productName(i.products),quantity:Number(i.quantity),size:i.size_name}))
     }))
    }});
   }
   const {data,error}=await db.rpc('beanbook_customer_summary',{p_brand_id:membership.brand_id});
   if(error)throw error;
   return json({customers:((data||[]) as SummaryRow[]).map(r=>({
    id:r.customer_id,name:r.customer_name,phone:r.phone,ltv:Number(r.lifetime_value||0),
    orderCount:Number(r.order_count||0),latestOrderAt:r.latest_order_at
   }))});
  }

  // The browser's selected business is not trusted. Only verified owners may edit.
  if(membership.role!=='owner')return json({error:'Only the Business Admin can edit customers'},403);
  if(!(req.headers.get('content-type')||'').toLowerCase().includes('application/json'))return json({error:'Expected JSON request'},415);
  const body:unknown=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid customer details'},400);
  const input=body as Record<string,unknown>;
  if(!uuid(input.id)||typeof input.name!=='string'||typeof input.phone!=='string')return json({error:'Invalid customer details'},400);
  const name=input.name.trim();
  const phone=input.phone.replace(/\s/g,'');
  if(name.length<2||name.length>120)return json({error:'Customer name must be 2–120 characters'},400);
  if(!/^\+[1-9][0-9]{7,14}$/.test(phone))return json({error:'Enter an international phone number, e.g. +919876543210'},400);

  const {data,error}=await db.from('customers')
   .update({name,phone,updated_at:new Date().toISOString()})
   .eq('id',input.id).eq('brand_id',membership.brand_id)
   .select('id,name,phone').maybeSingle();
  if(error?.code==='23505')return json({error:'Another customer in this business already uses that phone number'},409);
  if(error)throw error;
  if(!data)return json({error:'Customer not found in your business'},404);
  return json({customer:data});
 }catch(e){console.error('Customer directory request failed',e);return json({error:'Unable to manage customers right now'},500);}
}
