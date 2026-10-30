import { useEffect, useState, type FormEvent } from 'react';
import { createClient } from '@supabase/supabase-js';
type Business={id:string;name:string;created_at:string};
type Invite={id:string;brand_id:string;email:string;status:string;created_at:string};
type State={businesses:Business[];invitations:Invite[];settings:{sender_name?:string;sender_email?:string;reply_to_email?:string}};
const authUrl=import.meta.env.VITE_SUPABASE_URL;
const authKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase=authUrl&&authKey?createClient(authUrl,authKey):null;
export default function PlatformAdminPage(){
  const [username,setUsername]=useState('admin'),[password,setPassword]=useState('');
  const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [data,setData]=useState<State|null>(null);
  const [businessName,setBusinessName]=useState(''),[inviteBrand,setInviteBrand]=useState(''),[inviteEmail,setInviteEmail]=useState('');
  const [senderName,setSenderName]=useState('BeanBook'),[senderEmail,setSenderEmail]=useState(''),[replyTo,setReplyTo]=useState('');

  async function request(action:string, extra:Record<string,unknown>={}, sessionToken=token) {
    const response=await fetch('/api/platform-admin',{method:'POST',headers:{'Content-Type':'application/json',...(sessionToken?{'Authorization':'Bearer '+sessionToken}:{})},body:JSON.stringify({action,...extra})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Operation failed');
    return result;
  }
  async function refresh(t=token){
    const result=await request('summary',{},t) as State;
    setData(result);
    setSenderName(result.settings?.sender_name||'BeanBook');
    setSenderEmail(result.settings?.sender_email||'');
    setReplyTo(result.settings?.reply_to_email||'');
  }
  useEffect(()=>{
    if(!supabase)return;
    void supabase.auth.getSession().then(async ({data:auth})=>{
      if(auth.session?.access_token){
        try{await refresh(auth.session.access_token);setToken(auth.session.access_token);}
        catch{await supabase.auth.signOut();}
      }
    });
  // Only run on mount; token refresh is handled by the Supabase client.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function login(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      const result=await request('login',{username,password});
      if(!supabase)throw new Error('Supabase configuration is unavailable.');
      const established=await supabase.auth.setSession({access_token:result.access_token,refresh_token:result.refresh_token});
      if(established.error)throw established.error;
      setToken(established.data.session?.access_token||'');
      await refresh(established.data.session!.access_token);
      setPassword('');
    }catch(e){setError(e instanceof Error?e.message:'Authentication failed');}
    finally{setBusy(false);}
  }
  async function action(e:FormEvent,name:string,payload:Record<string,unknown>,done?:()=>void){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const session=await supabase?.auth.getSession();
      const t=session?.data.session?.access_token||token;
      const response=await request(name,payload,t);
      setNotice(response.message||'Saved successfully.');done?.();await refresh(t);
    }catch(e){setError(e instanceof Error?e.message:'Request failed');}
    finally{setBusy(false);}
  }
  async function signOut(){await supabase?.auth.signOut();setToken('');setData(null);}
  if(!supabase)return <main className="min-h-screen bg-[#f5f3ef] p-8 text-zinc-900"><section className="mx-auto mt-20 max-w-xl rounded-3xl bg-white p-8"><h1 className="text-2xl font-semibold">Platform Admin setup required</h1><p className="mt-3 text-sm leading-7">Configure the existing Supabase publishable URL/key for the Deploy Preview. No administrator credentials or live access secrets are embedded in the frontend.</p></section></main>;
  if(!data)return <main className="flex min-h-screen items-center justify-center bg-[#f5f3ef] px-5 py-12 text-zinc-900"><form onSubmit={login} className="w-full max-w-md space-y-5 rounded-3xl bg-white p-8 shadow-lg"><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">BeanBook · Platform Access</p><h1 className="text-3xl font-semibold">Platform Administration</h1><p className="text-sm text-zinc-500">Only the designated platform administrator may create or configure business accounts.</p><label className="block text-sm font-semibold" htmlFor="p-user">Username</label><input id="p-user" value={username} onChange={e=>setUsername(e.target.value)} required autoComplete="username" className="w-full rounded-xl border p-3"/><label className="block text-sm font-semibold" htmlFor="p-password">Password</label><input id="p-password" type="password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password" className="w-full rounded-xl border p-3"/>{error&&<p role="alert" className="break-words text-sm text-red-700">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-[#1b2822] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?'Verifying…':'Secure sign in'}</button><p className="text-xs text-zinc-500">Access requires a provisioned Supabase Auth identity and a matching platform-admin record. No default password exists.</p></form></main>;
  return <div className="min-h-screen bg-[#f5f3ef] text-zinc-900"><header className="flex flex-wrap justify-between gap-4 bg-[#1b2822] px-6 py-5 text-white sm:px-10"><div><p className="text-lg font-bold">BeanBook <span className="font-normal text-white/60">/ Platform</span></p><p className="text-xs text-white/60">Central business administration</p></div><button onClick={()=>void signOut()} className="rounded-lg border border-white/20 px-4 py-2 text-sm">Sign out</button></header><main className="mx-auto max-w-6xl space-y-7 px-5 py-10 sm:px-8"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Platform Administration</p><h1 className="mt-2 text-3xl font-semibold">Business Onboarding</h1><p className="mt-2 text-sm text-zinc-500">Create business accounts, send authorized invitations, and configure the onboarding sender.</p></div>{error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p>}
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Create a business</h2><p className="mt-1 text-sm text-zinc-500">Only platform administrators may provision a new tenant.</p><form className="mt-6 space-y-4" onSubmit={e=>void action(e,'create-business',{businessName},()=>setBusinessName(''))}><label htmlFor="p-business" className="block text-sm font-semibold">Business display name</label><input id="p-business" required minLength={2} maxLength={120} value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Business name" className="w-full rounded-xl border p-3"/><button disabled={busy} className="rounded-xl bg-[#1b2822] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Create business account</button></form></section>
      <section className="rounded-2xl bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Send onboarding invitation</h2><p className="mt-1 text-sm text-zinc-500">Invite a POC as the owner of an existing business.</p><form className="mt-6 space-y-4" onSubmit={e=>void action(e,'invite-owner',{brandId:inviteBrand,email:inviteEmail},()=>setInviteEmail(''))}><label htmlFor="p-target" className="block text-sm font-semibold">Business</label><select id="p-target" required value={inviteBrand} onChange={e=>setInviteBrand(e.target.value)} className="w-full rounded-xl border bg-white p-3"><option value="">Select business</option>{data.businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><label htmlFor="p-invite-email" className="block text-sm font-semibold">POC email address</label><input id="p-invite-email" required type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="owner@example.com" className="w-full rounded-xl border p-3"/><button disabled={busy} className="rounded-xl bg-[#1b2822] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Send invitation</button></form></section>
      <section className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2"><h2 className="text-xl font-semibold">Onboarding email settings</h2><p className="mt-1 text-sm text-zinc-500">Choose the display name and verified sender address. Email delivery requires a configured email provider.</p><form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={e=>void action(e,'save-email-settings',{senderName,senderEmail,replyTo})}><div><label htmlFor="p-sender-name" className="mb-2 block text-sm font-semibold">Sender name</label><input id="p-sender-name" required value={senderName} onChange={e=>setSenderName(e.target.value)} className="w-full rounded-xl border p-3"/></div><div><label htmlFor="p-sender-email" className="mb-2 block text-sm font-semibold">Verified sender email</label><input id="p-sender-email" type="email" required value={senderEmail} onChange={e=>setSenderEmail(e.target.value)} className="w-full rounded-xl border p-3"/></div><div><label htmlFor="p-reply" className="mb-2 block text-sm font-semibold">Reply-to email (optional)</label><input id="p-reply" type="email" value={replyTo} onChange={e=>setReplyTo(e.target.value)} className="w-full rounded-xl border p-3"/></div><div className="flex items-end"><button disabled={busy} className="w-full rounded-xl bg-[#1b2822] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Save email settings</button></div></form></section>
    </div>
    <section className="rounded-2xl bg-white p-6 shadow-sm"><div className="mb-4 flex flex-wrap items-center justify-between"><h2 className="text-xl font-semibold">Registered businesses</h2><span className="text-sm text-zinc-500">{data.businesses.length} listed</span></div><div className="divide-y">{data.businesses.map(b=><div key={b.id} className="flex justify-between gap-4 py-4"><span className="font-medium">{b.name}</span><span className="text-xs text-zinc-500">{new Date(b.created_at).toLocaleDateString()}</span></div>)}</div></section>
    <section className="rounded-2xl bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Recent invitations</h2><div className="mt-4 divide-y">{data.invitations.map(i=><div key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span className="break-all">{i.email}</span><span className="rounded-full bg-zinc-100 px-3 py-1 text-xs capitalize">{i.status}</span></div>)}{data.invitations.length===0&&<p className="text-sm text-zinc-500">No invitations sent yet.</p>}</div></section>
  </main></div>;
}
