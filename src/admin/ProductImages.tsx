import {useCallback,useEffect,useImperativeHandle,useRef,useState,type Ref} from 'react';
import {adminSupabase} from './client';
export type ProductImage={id:string;product_id:string;slot:number;url:string};
export type ProductImagesHandle={uploadQueued:(productId:string)=>Promise<void>};
type Props={productId:string|null;apiRef:Ref<ProductImagesHandle>;onImagesChanged?:(images:ProductImage[])=>void};
const btn='rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-50';
export default function ProductImages({productId,apiRef,onImagesChanged}:Props){
 const [images,setImages]=useState<ProductImage[]>([]);
 const [pending,setPending]=useState<number|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [queued,setQueued]=useState<{slot:number;file:File;url:string}[]>([]);
 const queuedRef=useRef(queued);
 queuedRef.current=queued;
 useEffect(()=>()=>{queuedRef.current.forEach(q=>URL.revokeObjectURL(q.url));},[]);
 const getToken=useCallback(async()=>{
  if(!adminSupabase)throw new Error('Business connection unavailable');
  const {data}=await adminSupabase.auth.getSession();
  if(!data.session?.access_token)throw new Error('Sign in again');
  return data.session.access_token;
 },[]);
 const fetchImages=useCallback(async()=>{
  const token=await getToken();
  const res=await fetch('/api/business-products?mode=images',{headers:{Authorization:'Bearer '+token}});
  if(!(res.headers.get('content-type')||'').includes('application/json'))throw new Error('Image service unavailable (HTTP '+res.status+')');
  const body=await res.json();
  if(!res.ok)throw new Error(body.error||'Cannot load images');
  const all=(body.images||[]) as ProductImage[];
  const filtered=productId?all.filter(x=>x.product_id===productId):[];
  setImages(filtered);onImagesChanged?.(all);
  return filtered;
 },[getToken,productId,onImagesChanged]);
 useEffect(()=>{if(!productId){setImages([]);return;}let active=true;setLoading(true);void fetchImages().catch(e=>{if(active)setError(String(e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[productId,fetchImages]);
 const process=useCallback(async(slot:number,action:'upload'|'remove',file?:File,overrideId?:string)=>{
  const id=overrideId||productId;
  if(!id)throw new Error('Save the product details before uploading');
  const form=new FormData();form.set('action',action);form.set('productId',id);form.set('slot',String(slot));
  if(file)form.set('file',file);
  const token=await getToken();
  const res=await fetch('/api/business-products?mode=images',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});
  if(!(res.headers.get('content-type')||'').includes('application/json'))throw new Error('Image service unavailable (HTTP '+res.status+')');
  const result=await res.json();
  if(!res.ok)throw new Error(result.error||'Image operation failed');
 },[getToken,productId]);
 async function upload(slot:number,file:File){
  setPending(slot);setError('');setNotice('');
  try{await process(slot,'upload',file);await fetchImages();setNotice('Photo saved.');}
  catch(e){setError(e instanceof Error?e.message:'Could not upload photo');}
  finally{setPending(null);}
 }
 async function remove(slot:number){
  setPending(slot);setError('');setNotice('');
  try{await process(slot,'remove');await fetchImages();setNotice('Photo removed.');}
  catch(e){setError(e instanceof Error?e.message:'Could not remove photo');}
  finally{setPending(null);}
 }
 function stage(slot:number,file?:File){
  if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2097152||file.size===0){setError('Choose a JPEG, PNG or WebP photo under 2 MB.');return;}
  if(productId){void upload(slot,file);return;}
  setQueued(old=>{
   old.filter(q=>q.slot===slot).forEach(q=>URL.revokeObjectURL(q.url));
   return [...old.filter(q=>q.slot!==slot),{slot,file,url:URL.createObjectURL(file)}];
  });
  setError('');
 }
 async function uploadQueued(id:string){
  const pendingFiles=[...queuedRef.current].sort((a,b)=>a.slot-b.slot);
  if(!pendingFiles.length)return;
  setError('');setNotice('');
  for(const q of pendingFiles){
   setPending(q.slot);
   try{
    await process(q.slot,'upload',q.file,id);
    setQueued(prev=>{const kept=prev.filter(x=>x.slot!==q.slot);URL.revokeObjectURL(q.url);return kept;});
   }catch(e){
    setError('Product saved, but photo '+q.slot+' failed to upload: '+(e instanceof Error?e.message:String(e))+'. Edit the product to retry.');
    setPending(null);
    throw e;
   }
  }
  setPending(null);setNotice('All photos uploaded.');
 }
 useImperativeHandle(apiRef,()=>({uploadQueued}));
 return <section className="space-y-3 rounded-xl border border-zinc-200 p-4">
  <div><h5 className="font-semibold">Product photos <span className="font-normal text-zinc-500">(optional)</span></h5><p className="mt-1 text-sm text-zinc-500">Up to three images, 2 MB each. The first photo will be the menu cover.</p></div>
  {loading&&<p className="text-sm text-zinc-500">Loading photos…</p>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
   {[1,2,3].map(slot=>{
    const existing=images.find(x=>x.slot===slot);
    const staged=queued.find(x=>x.slot===slot);
    const img=staged?.url||existing?.url;
    return <div key={slot} className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
     <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{slot===1?'Cover photo':'Photo '+slot}</p>
     <div className="aspect-square overflow-hidden rounded-lg bg-zinc-100">{img?<img src={img} alt={'Product photo '+slot} className="h-full w-full object-cover"/>:<div className="flex h-full items-center justify-center text-xs text-zinc-400">No image</div>}</div>
     <label className={btn+' block cursor-pointer text-center'}>{pending===slot?'Uploading…':img?'Replace':'Choose photo'}
      <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending!==null} onChange={e=>{stage(slot,e.target.files?.[0]);e.target.value='';}}/>
     </label>
     {img&&<button type="button" className={btn+' w-full'} disabled={pending!==null} onClick={()=>{
      if(staged){setQueued(v=>v.filter(x=>x.slot!==slot));URL.revokeObjectURL(staged.url);}
      else void remove(slot);
     }}>{pending===slot?'Working…':'Remove'}</button>}
    </div>;
   })}
  </div>
  {!productId&&queued.length>0&&<p className="text-xs text-zinc-500">{queued.length} photo(s) selected. They will upload after the product is saved.</p>}
 </section>;
}
