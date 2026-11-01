import { useState, type FormEvent } from 'react';
import { adminSupabase } from './client';

export default function LoginPanel() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminSupabase) return;
    setBusy(true);
    setError('');
    setMessage('');
    const { error: signInError } = await adminSupabase.auth.signInWithPassword({ email, password });
    if (signInError) setError('Sign-in failed. Check your credentials or invitation.');
    setBusy(false);
  }

  async function setInvitationPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminSupabase) return;
    setBusy(true);
    setError('');
    const { data: user, error: userError } = await adminSupabase.auth.getUser();
    if (userError || !user.user) {
      setError('Open your invitation link first, then set your password here.');
    } else {
      const { error: updateError } = await adminSupabase.auth.updateUser({ password });
      if (updateError) setError(updateError.message);
      else setMessage('Password saved. Your business workspace is now loading.');
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-[#f5f3ef] px-4 py-12 text-zinc-900">
      <div className="mx-auto flex w-full max-w-md flex-col gap-10">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1d2823] text-xl font-black text-white">B</span>
          <div><p className="text-xl font-semibold tracking-tight">BeanBook</p>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">Business workspace</p></div>
        </div>
        <div className="rounded-[28px] border border-[#e8e5df] bg-white p-8 shadow-[0_24px_70px_-36px_rgba(0,0,0,0.24)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#688170]">Invitation-only access</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Welcome back.</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">Sign in to manage your business. Accounts are created only through authorized invitations.</p>
          <form className="mt-8 space-y-5" onSubmit={signIn}>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="business-email">Email</label>
              <input id="business-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@business.com" className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-[#668874] focus:ring-2 focus:ring-[#668874]/20" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="business-password">Password</label>
              <input id="business-password" type="password" autoComplete="current-password" required minLength={8}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password" className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-[#668874] focus:ring-2 focus:ring-[#668874]/20" />
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {message && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-[#1d2823] px-5 py-3.5 font-semibold text-white transition hover:bg-[#34463c] disabled:opacity-60">
              {busy ? 'Please wait…' : 'Sign in to BeanBook'}
            </button>
          </form>
          <form className="mt-5" onSubmit={setInvitationPassword}>
            <button type="submit" disabled={busy || password.length < 8}
              className="w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:border-zinc-400 disabled:opacity-50">
              Set password after accepting invitation
            </button>
          </form>
        </div>
        <p className="text-center text-xs leading-6 text-zinc-500">BeanBook never requests your banking password or UPI PIN.</p>
      </div>
    </div>
  );
}
