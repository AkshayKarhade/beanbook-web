import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminSupabase } from './client';
import { BUSINESS_ADMIN_ROLE_LABEL, BUSINESS_ADMIN_PRIVILEGES, BUSINESS_ADMIN_SCOPE_NOTE } from './businessAdminAccess';

type Account = { email: string; business: string; role: 'owner' };

export default function ActivationPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!adminSupabase) {
        if (active) { setError('BeanBook authentication has not been configured.'); setLoading(false); }
        return;
      }
      try {
        const { data: auth, error: authError } = await adminSupabase.auth.getUser();
        if (authError || !auth.user) {
          if (active) { setError('This activation link is invalid, expired, or has already been used. Request a new invitation from your BeanBook administrator.'); setLoading(false); }
          return;
        }

        // Membership is provisioned by the central platform administrator.
        // Never accept a brand ID or role from URL parameters or user metadata.
        const { data: membership, error: membershipError } = await adminSupabase
          .from('admin_users')
          .select('brand_id, role')
          .eq('supabase_user_id', auth.user.id)
          .maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership || membership.role !== 'owner') throw new Error('This activation link is not associated with a Business Admin invitation.');

        const { data: brand, error: brandError } = await adminSupabase
          .from('brands')
          .select('name')
          .eq('id', membership.brand_id)
          .single();
        if (brandError) throw brandError;
        if (active) { setAccount({ email: auth.user.email || '', business: brand.name, role: 'owner' }); setError(''); setLoading(false); }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not validate the invitation.');
          setLoading(false);
        }
      }
    }
    void load();
    const { data: subscription } = adminSupabase?.auth.onAuthStateChange(() => {
      // Supabase parses the invite token asynchronously. Recheck after the event.
      window.setTimeout(() => { if (active) void load(); }, 0);
    }) || { data: undefined };
    return () => { active = false; subscription?.subscription.unsubscribe(); };
  }, []);

  async function activate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!adminSupabase || !account) return;
    if (password.length < 12) { setError('Choose a password with at least 12 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await adminSupabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { data: auth } = await adminSupabase.auth.getSession();
      if (!auth.session?.access_token) throw new Error('Password saved, but the session expired. Sign in with your new password to finish onboarding.');
      const checkpoint = await fetch('/api/business-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.session.access_token },
        body: JSON.stringify({ action: 'credentials-set' }),
      });
      if (!checkpoint.ok) {
        throw new Error('Password saved, but the activation checkpoint could not be recorded. Sign in with your new password and contact BeanBook support.');
      }
      setPassword('');
      setConfirmPassword('');
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to set password. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f3ef] px-5 py-12 text-[#202923]">
      <div className="w-full max-w-md rounded-3xl border border-[#e8e5df] bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1b2822] text-lg font-bold text-white">B</span>
          <div><p className="text-xl font-semibold">BeanBook</p><p className="text-xs uppercase tracking-widest text-zinc-500">Business activation</p></div>
        </div>
        {loading ? <p role="status" className="text-zinc-500">Verifying your invitation…</p> :
        !account ? <>
          <h1 className="text-2xl font-semibold">Activation unavailable</h1>
          <p role="alert" className="mt-4 break-words text-sm leading-7 text-red-700">{error}</p>
          <Link className="mt-6 inline-block text-sm font-semibold text-emerald-800 underline" to="/admin">Back to business login</Link>
        </> : <>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#688170]">Invitation verified</p>
          <h1 className="mt-3 text-2xl font-semibold">Activate your Business Admin account</h1>
          <p className="mt-2 text-lg font-semibold">{account.business}</p>
          <p className="mt-1 text-sm font-medium text-emerald-800">Role: {BUSINESS_ADMIN_ROLE_LABEL}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">Activate your BeanBook business account for {account.email} by choosing your own password.</p>
          <section aria-label="Business Admin privileges" className="mt-5 rounded-xl border border-zinc-200 bg-[#f5f3ef] p-4"><h2 className="font-semibold">Your business privileges</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">{BUSINESS_ADMIN_PRIVILEGES.map(privilege=><li key={privilege}>{privilege}</li>)}</ul><p className="mt-3 text-xs leading-5 text-zinc-600">{BUSINESS_ADMIN_SCOPE_NOTE}</p></section>
          <form className="mt-6 space-y-4" onSubmit={activate}>
            <div><label htmlFor="activate-password" className="mb-2 block text-sm font-medium">Create password</label>
            <input id="activate-password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-3" /></div>
            <div><label htmlFor="activate-confirm" className="mb-2 block text-sm font-medium">Confirm password</label>
            <input id="activate-confirm" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-3" /></div>
            {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
            <button disabled={saving} type="submit" className="w-full rounded-xl bg-[#1b2822] px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Activating…' : 'Activate my business account'}</button>
          </form>
        </>}
      </div>
    </main>
  );
}
