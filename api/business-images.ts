import {createClient} from '@supabase/supabase-js';
const json=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}});
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const mimeExt:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
type ImageRow={id:string;product_id:string;slot:number;storage_path:string;content_type:string};
export default async function productImages(req:Request){
 if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Origin denied'},403);
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)return json({error:'Image storage not configured'},503);
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)return json({error:'Sign in required'},401);
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:identity,error:authError}=await db.auth.getUser(token);
  if(authError||!identity.user||identity.user.is_anonymous)return json({error:'Session expired'},401);
  const {data:membership,error:memberError}=await db.from('admin_users').select('brand_id,role').eq('supabase_user_id',identity.user.id).maybeSingle();
  if(memberError)throw memberError;
  if(!membership||membership.role!=='owner')return json({error:'Business Owner required'},403);
  const brand=membership.brand_id;
  const url=new URL(req.url);
  if(req.method==='GET'){
   const {data,error}=await db.from('product_images').select('id,product_id,slot,storage_path,content_type').eq('brand_id',brand).order('slot');
   if(error)throw error;
   return json({images:(data||[]).map((row:ImageRow)=>({...row,url:db.storage.from('product-images').getPublicUrl(row.storage_path).data.publicUrl}))});
  }
  // Keep Netlify request bodies small; do not accept arbitrary large files.
  const type=req.headers.get('content-type')||'';
  if(!type.includes('multipart/form-data'))return json({error:'Multipart upload required'},415);
  const length=Number(req.headers.get('content-length')||'0');
  if(length>3*1024*1024)return json({error:'Image exceeds the upload limit'},413);
  const form=await req.formData();
  const action=form.get('action');
  const productId=form.get('productId');
  const slotNumber=Number(form.get('slot'));
  if(!uuid(productId)||!Number.isInteger(slotNumber)||slotNumber<1||slotNumber>3)return json({error:'Invalid product or image slot'},400);
  const {data:product,error:productError}=await db.from('products').select('id').eq('id',productId).eq('brand_id',brand).maybeSingle();
  if(productError)throw productError;
  if(!product)return json({error:'Product not found in your business'},404);
  const {data:old,error:oldError}=await db.from('product_images').select('id,storage_path').eq('brand_id',brand).eq('product_id',productId).eq('slot',slotNumber).maybeSingle();
  if(oldError)throw oldError;
  const storage=db.storage.from('product-images');
  if(action==='remove'){
   if(!old)return json({ok:true});
   const {error:removeError}=await storage.remove([old.storage_path]);
   if(removeError)throw removeError;
   const {error:deleteError}=await db.from('product_images').delete().eq('id',old.id).eq('brand_id',brand);
   if(deleteError)throw deleteError;
   return json({ok:true});
  }
  if(action!=='upload')return json({error:'Unsupported action'},400);
  const file=form.get('file');
  if(!(file instanceof File)||!mimeExt[file.type]||file.size===0||file.size>2097152)return json({error:'Choose a JPEG, PNG or WebP image up to 2 MB'},400);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10;
  const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!((file.type==='image/jpeg'&&jpeg)||(file.type==='image/png'&&png)||(file.type==='image/webp'&&webp)))return json({error:'File content does not match the image type'},400);
  const path=brand+'/'+productId+'/'+slotNumber+'-'+crypto.randomUUID()+'.'+mimeExt[file.type];
  const {error:uploadError}=await storage.upload(path,bytes,{contentType:file.type,cacheControl:'3600',upsert:false});
  if(uploadError)throw uploadError;
  const {data:saved,error:saveError}=await db.from('product_images').upsert({brand_id:brand,product_id:productId,slot:slotNumber,storage_path:path,content_type:file.type},{onConflict:'product_id,slot'}).select('id').single();
  if(saveError){
   await storage.remove([path]);
   throw saveError;
  }
  if(old&&old.storage_path!==path){
   const {error:cleanupError}=await storage.remove([old.storage_path]);
   if(cleanupError)console.error('Old product image cleanup pending:',cleanupError);
  }
  return json({ok:true,id:saved.id,url:storage.getPublicUrl(path).data.publicUrl});
 }catch(e){console.error('Product image API failed',e);return json({error:'Unable to manage product images. Check storage configuration and retry.'},500);}
}
