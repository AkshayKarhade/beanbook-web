import {createClient} from '@supabase/supabase-js';
const uuid=(v:string|null)=>!!v&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export default async function publicMenu(req:Request){
 if(req.method!=='GET')return Response.json({error:'Method not allowed'},{status:405});
 const menuId=new URL(req.url).searchParams.get('id');
 if(!uuid(menuId))return Response.json({error:'Invalid menu link'},{status:400});
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)return Response.json({error:'Menu service unavailable'},{status:503});
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:menu,error}=await db.from('events').select('id,brand_id,name,location,sales_mode,status,event_start_date,event_end_date').eq('id',menuId!).in('sales_mode',['regular','event']).eq('status','published').maybeSingle();
  if(error)throw error;
  if(!menu)return Response.json({error:'Menu is not published'},{status:404});
  const {data:brand,error:be}=await db.from('brands').select('name').eq('id',menu.brand_id).single();if(be)throw be;
  const {data:items,error:ie}=await db.from('event_products').select('id,product_id,price_override,display_order,products!inner(id,brand_id,name,description,price,is_active,category)').eq('event_id',menu.id).eq('is_available',true).eq('products.brand_id',menu.brand_id).eq('products.is_active',true).order('display_order');if(ie)throw ie;
  const ids=(items||[]).map(x=>x.product_id);
  const assignmentIds=(items||[]).map(x=>x.id);
  const [sizes,overrides,images]=await Promise.all([
   ids.length?db.from('product_sizes').select('product_id,name,price,display_order').eq('brand_id',menu.brand_id).in('product_id',ids):Promise.resolve({data:[],error:null}),
   assignmentIds.length?db.from('event_product_size_prices').select('event_product_id,size_name,price').eq('brand_id',menu.brand_id).in('event_product_id',assignmentIds):Promise.resolve({data:[],error:null}),
   ids.length?db.from('product_images').select('product_id,slot,storage_path').eq('brand_id',menu.brand_id).in('product_id',ids).order('slot'):Promise.resolve({data:[],error:null})
  ]);
  if(sizes.error||overrides.error||images.error)throw sizes.error||overrides.error||images.error;
  const products=(items||[]).map(i=>{
   const p=Array.isArray(i.products)?i.products[0]:i.products;
   const productSizes=(sizes.data||[]).filter(s=>s.product_id===i.product_id).sort((a,b)=>a.display_order-b.display_order);
   return {id:i.product_id,name:p.name,description:p.description,category:p.category,
    price:productSizes.length?null:Number(i.price_override??p.price),
    sizes:productSizes.map(s=>({name:s.name,price:Number((overrides.data||[]).find(o=>o.event_product_id===i.id&&o.size_name===s.name)?.price??s.price)})),
    images:(images.data||[]).filter(image=>image.product_id===i.product_id).map(image=>db.storage.from('product-images').getPublicUrl(image.storage_path).data.publicUrl)
   };
  });
  return Response.json({menu:{id:menu.id,name:menu.name,location:menu.location,sales_mode:menu.sales_mode,start:menu.event_start_date,end:menu.event_end_date},business:brand.name,products},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Published menu read failed',e);return Response.json({error:'Could not load this menu'},{status:500});}
}
