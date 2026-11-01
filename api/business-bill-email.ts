import {createClient} from '@supabase/supabase-js';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
const money=(value:unknown)=>'INR '+Number(value).toFixed(2);
const nameOf=(v:{name:string}|{name:string}[]|null)=>Array.isArray(v)?v[0]?.name||'Item':v?.name||'Item';
type Addon={addon_name:string};
type Item={quantity:number;unit_price:number|string;size_name:string|null;fulfillment_status:string|null;products:{name:string}|{name:string}[]|null;order_item_addons:Addon[]};
type Order={id:string;order_number:string;customer_id:string|null;total_amount:number|string;payment_status:string;created_at:string;order_items:Item[]};
const validEmail=(s:string)=>s.length>=5&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export default async function sendBillEmail(req:Request){
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Cross-origin request blocked'},403);
 if(!(req.headers.get('content-type')||'').includes('application/json'))return json({error:'JSON required'},415);
 if(!process.env.RESEND_API_KEY||!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)return json({error:'Bill email delivery is not configured'},503);
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)return json({error:'Sign in required'},401);
 const input:unknown=await req.json().catch(()=>null);
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'Invalid request'},400);
 const {orderId,requestId,email}=input as Record<string,unknown>;
 if(!uuid(orderId)||!uuid(requestId)||typeof email!=='string'||!validEmail(email.trim().toLowerCase()))return json({error:'Enter a valid email address'},400);
 const recipient=email.trim().toLowerCase();
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:auth,error:ae}=await db.auth.getUser(token);
  if(ae||!auth.user||auth.user.is_anonymous)return json({error:'Session expired'},401);
  const {data:staff,error:se}=await db.from('admin_users').select('brand_id,role').eq('supabase_user_id',auth.user.id).maybeSingle();
  if(se)throw se;
  if(!staff||!['owner','staff'].includes(staff.role))return json({error:'Business staff access required'},403);
  const {data:order,error:oe}=await db.from('orders')
   .select('id,order_number,customer_id,total_amount,payment_status,created_at,order_items(quantity,unit_price,size_name,fulfillment_status,products(name),order_item_addons(addon_name))')
   .eq('id',orderId).eq('brand_id',staff.brand_id).eq('workflow_version',2).maybeSingle();
  if(oe)throw oe;
  if(!order||!order.customer_id)return json({error:'This bill has no linked customer'},404);
  const bill=order as Order;
  const {data:customer,error:ce}=await db.from('customers').select('id,name').eq('id',bill.customer_id).eq('brand_id',staff.brand_id).maybeSingle();
  if(ce)throw ce;
  if(!customer)return json({error:'Customer not found'},404);
  const {data:brand,error:be}=await db.from('brands').select('name').eq('id',staff.brand_id).single();
  if(be)throw be;
  const {data:sender,error:sde}=await db.from('platform_settings').select('sender_name,sender_email,reply_to_email').eq('id',1).maybeSingle();
  if(sde)throw sde;
  if(!sender?.sender_name||!sender.sender_email)return json({error:'Email sender is not configured'},503);

  const rows=bill.order_items.filter(i=>i.fulfillment_status!=='cancelled');
  const computed=rows.reduce((sum,i)=>sum+Number(i.unit_price)*i.quantity,0);
  if(rows.length===0||Math.abs(computed-Number(bill.total_amount))>0.009)return json({error:'Bill total does not match its items. No email sent.'},409);

  const {data:existing,error:ex}=await db.from('beanbook_bill_email_deliveries').select('id,order_id,recipient_email,status,provider_email_id').eq('brand_id',staff.brand_id).eq('request_id',requestId).maybeSingle();
  if(ex)throw ex;
  if(existing){
   if(existing.order_id!==orderId||existing.recipient_email!==recipient)return json({error:'This send request was already used for another bill or email'},409);
   if(existing.status==='sent')return json({sent:true,email:recipient,message:'This bill was already sent to this address.'});
   return json({error:'Delivery status is '+existing.status+'. Check email delivery before retrying with a new request.'},409);
  }
  const {data:claim,error:claimError}=await db.from('beanbook_bill_email_deliveries').insert({
   brand_id:staff.brand_id,order_id:orderId,customer_id:bill.customer_id,request_id:requestId,
   recipient_email:recipient,order_amount:bill.total_amount,status:'sending'
  }).select('id').single();
  if(claimError?.code==='23505')return json({error:'Bill send already in progress. Check its result before retrying.'},409);
  if(claimError)throw claimError;

  const paid=bill.payment_status==='paid';
  const items=rows.map(i=>{
   const addon=i.order_item_addons?.map(a=>a.addon_name).join(', ')||'';
   const detail=[i.size_name,addon].filter(Boolean).join(' · ');
   return {description:i.quantity+' × '+nameOf(i.products)+(detail?' ('+detail+')':''),total:Number(i.unit_price)*i.quantity};
  });
  const html='<div style="max-width:540px;margin:auto;font-family:Arial,sans-serif;color:#20382a;padding:20px">'+
   '<h2>'+escape(brand?.name||'Your café')+'</h2><p>Your bill '+escape(bill.order_number)+'</p>'+
   '<p>Hello '+escape(customer.name)+',</p><p>Thank you for visiting us. Here is your '+(paid?'paid receipt':'current bill')+'.</p>'+
   '<p><strong>Payment status: '+(paid?'PAID':'UNPAID — PAYMENT DUE')+'</strong></p>'+
   '<table style="border-collapse:collapse;width:100%">'+items.map(i=>'<tr><td style="padding:9px 4px;border-bottom:1px solid #ddd">'+escape(i.description)+'</td><td style="text-align:right;padding:9px 4px;border-bottom:1px solid #ddd;white-space:nowrap">'+escape(money(i.total))+'</td></tr>').join('')+'</table>'+
   '<p style="text-align:right;font-size:20px"><strong>Total: '+escape(money(bill.total_amount))+'</strong></p>'+
   (!paid?'<p>This is an unpaid bill. Please pay using the payment instructions provided by the café.</p>':'')+
   '<p style="font-size:12px;color:#647067">Order placed: '+escape(new Date(bill.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))+'</p></div>';
  const plain=[brand?.name||'Your café','Bill '+bill.order_number,'Customer: '+customer.name,'Payment: '+(paid?'PAID':'UNPAID - PAYMENT DUE'),...items.map(i=>i.description+' — '+money(i.total)),'Total: '+money(bill.total_amount)].join('\n');

  let response:Response;
  try{response=await fetch('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':requestId},
   body:JSON.stringify({from:sender.sender_name+' <'+sender.sender_email+'>',to:[recipient],subject:(paid?'Receipt':'Bill')+' '+bill.order_number+' · '+(brand?.name||'Your café'),html,text:plain,...(sender.reply_to_email?{reply_to:sender.reply_to_email}:{})})
  });}catch(err){
   console.error('Bill email transport error',err);
   await db.from('beanbook_bill_email_deliveries').update({status:'unknown',error_code:'transport_unknown'}).eq('id',claim.id);
   return json({error:'Email provider response is unknown. Check delivery records before retrying.'},502);
  }
  if(!response.ok){
   console.error('Bill email provider rejected request',response.status);
   await db.from('beanbook_bill_email_deliveries').update({status:'failed',error_code:'http_'+response.status}).eq('id',claim.id);
   return json({error:'Email provider rejected the bill. No confirmation was recorded.'},502);
  }
  const sent=await response.json().catch(()=>null);
  const providerId=typeof sent?.id==='string'?sent.id:null;
  if(!providerId){
   await db.from('beanbook_bill_email_deliveries').update({status:'unknown',error_code:'missing_provider_id'}).eq('id',claim.id);
   return json({error:'Email provider accepted the request but did not return a receipt ID. Check delivery history.'},502);
  }
  const {error:finalError}=await db.rpc('beanbook_mark_bill_email_sent',{p_delivery_id:claim.id,p_provider_id:providerId});
  if(finalError){
   console.error('Provider accepted bill but profile commit failed',finalError);
   return json({sent:true,profileSaved:false,email:recipient,message:'Email accepted by the provider, but the customer profile could not be saved. Please contact support.'},200);
  }
  return json({sent:true,profileSaved:true,email:recipient,message:'Bill sent to '+recipient+' and saved to the customer profile.'});
 }catch(e){console.error('Send bill email error',e);return json({error:'Unable to send the bill right now'},500);}
}
