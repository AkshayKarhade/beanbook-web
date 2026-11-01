import {createClient} from '@supabase/supabase-js';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export default async function businessCustomers(req:Request){
 if(req.method!=='GET')return json({error:'Method not allowed'},405);
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)return json({error:'Customer service unavailable'},503);
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)return json({error:'Sign in required'},401);
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user||auth.user.is_anonymous)return json({error:'Session expired'},401);
  const {data:membership,error:membershipError}=await db.from('admin_users').select('brand_id,role').eq('supabase_user_id',auth.user.id).maybeSingle();
  if(membershipError)throw membershipError;
  if(!membership||membership.role!=='owner')return json({error:'Business Owner access required'},403);
  const {data,error}=await db.rpc('beanbook_customer_summary',{p_brand_id:membership.brand_id});
  if(error)throw error;
  return json({customers:(data||[]).map((r:{customer_id:string;customer_name:string;phone:string;lifetime_value:number|string;order_count:number|string;latest_order_at:string|null})=>({
   id:r.customer_id,name:r.customer_name,phone:r.phone,ltv:Number(r.lifetime_value||0),
   orderCount:Number(r.order_count||0),latestOrderAt:r.latest_order_at
  }))});
 }catch(e){console.error('Customers summary failed',e);return json({error:'Unable to load customers right now'},500);}
}
