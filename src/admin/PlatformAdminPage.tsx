import { useEffect, useState, type FormEvent } from 'react';
import { adminSupabase as supabase } from './client';
type Business={id:string;name:string;created_at:string};
type Invite={id:string;brand_id:string;email:string;status:string;created_at:string};
type State={businesses:Business[];invitations:Invite[];settings:{sender_name?:string;sender_email?:string;reply_to_email?:string}};
export default function PlatformAdminPage(){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[showPassword,setShowPassword]=useState(false);
  const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [data,setData]=useState<State|null>(null);
  const [businessName,setBusinessName]=useState(''),[inviteBrand,setInviteBrand]=useState(''),[inviteEmail,setInviteEmail]=useState('');
  const [senderName,setSenderName]=useState('BeanBook'),[senderEmail,setSenderEmail]=useState(''),[replyTo,setReplyTo]=useState('');

  async function request(action:string, extra:Record<string,unknown>={}, sessionToken=token) {
    const response=await fetch('/api/platform-admin',{method:'POST',headers:{'Content-Type':'application/json',...(sessionToken?{'Authorization':'Bearer '+sessionToken}:{})},body:JSON.stringify({action,...extra})});
    const raw=await response.text();
    const mime=response.headers.get('content-type')||'';
    if(!raw.trim())throw new Error('Platform API returned an empty response (HTTP '+response.status+').');
    if(!mime.includes('application/json'))throw new Error('Platform API returned a non-JSON response (HTTP '+response.status+'). Check the Netlify Function route.');
    let result: Record<string, unknown>;
    try { result=JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new Error('Platform API returned invalid JSON (HTTP '+response.status+').'); }
    if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'Platform API failed (HTTP '+response.status+').');
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
        catch{await supabase?.auth.signOut();}
      }
    });
  // Only run on mount; token refresh is handled by the Supabase client.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function login(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      if(!supabase)throw new Error('Supabase authentication is not configured.');
      // Supabase validates the email and password. The Platform API separately
      // checks platform_admins authorization before returning any business data.
      const {data:auth,error:authError}=await supabase.auth.signInWithPassword({
        email:email.trim().toLowerCase(),password,
      });
      if(authError)throw new Error(authError.message);
      const sessionToken=auth.session?.access_token;
      if(!sessionToken)throw new Error('Sign-in did not establish a session.');
      try{
        await refresh(sessionToken);
        setToken(sessionToken);
        setPassword('');
        setShowPassword(false);
      }catch(authorizeError){
        await supabase.auth.signOut();
        throw authorizeError;
      }
    }catch(e){setError(e instanceof Error?e.message:'Authentication failed');}
    finally{setBusy(false);}
  }
  async function action(e:FormEvent,name:string,payload:Record<string,unknown>,done?:()=>void){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const session=await supabase?.auth.getSession();
      const t=session?.data.session?.access_token||token;
      const response=await request(name,payload,t);
      setNotice(typeof response.message==='string'?response.message:'Saved successfully.');done?.();await refresh(t);
    }catch(e){setError(e instanceof Error?e.message:'Request failed');}
    finally{setBusy(false);}
  }
  async function signOut(){await supabase?.auth.signOut();setToken('');setData(null);}
  if(!supabase)return <main className="min-h-screen bg-[#f5f3ef] p-8 text-zinc-900"><section className="mx-auto mt-20 max-w-xl rounded-3xl bg-white p-8"><h1 className="text-2xl font-semibold">Platform Admin setup required</h1><p className="mt-3 text-sm leading-7">Configure the existing Supabase publishable URL/key for the Deploy Preview. No administrator credentials or live access secrets are embedded in the frontend.</p></section></main>;
  if(!data)return <main className="flex min-h-screen items-center justify-center bg-[#f5f3ef] px-5 py-12 text-zinc-900"><form onSubmit={login} className="w-full max-w-md space-y-5 rounded-3xl bg-white p-8 shadow-lg"><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">BeanBook · Platform Access</p><h1 className="text-3xl font-semibold">Platform Administration</h1><p className="text-sm text-zinc-500">Only the designated platform administrator may create or configure business accounts.</p><label className="block text-sm font-semibold" htmlFor="p-email">Email address</label><input id="p-email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} required className="w-full rounded-xl border p-3"/><label className="block text-sm font-semibold" htmlFor="p-password">Password</label><div className="relative"><input id="p-password" type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password" className="w-full rounded-xl border py-3 pl-3 pr-14"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} title={showPassword?'Hide password':'Show password'} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-zinc-600 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{showPassword?<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10 10 0 0 1 12 5c5.2 0 9 4.5 10 7a15 15 0 0 1-3.1 4.1M6.2 6.2C3.7 8 2.4 10.4 2 12c1 2.5 4.8 7 10 7 1.4 0 2.7-.3 3.8-.8"/></svg>:<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>}</button></div>{error&&<p role="alert" className="break-words text-sm text-red-700">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-[#1b2822] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?'Verifying…':'Secure sign in'}</button><p className="text-xs text-zinc-500">Sign in using the email address and password of your Supabase Auth user. Platform access is checked separately.</p></form></main>;
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
