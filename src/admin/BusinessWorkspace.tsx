import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminBackendConfigured, adminSupabase } from './client';
import LoginPanel from './LoginPanel';
import ProductsPage from './ProductsPage';
import MenusPage from './MenusPage';
import CustomersPage from './CustomersPage';
import BusinessPaymentSettings from './BusinessPaymentSettings';
import LiveOrders from './LiveOrders';
import { useBusinessSession } from './useBusinessSession';

type Section = 'overview' | 'products' | 'orders' | 'events' | 'customers' | 'reports' | 'settings';

const nav: { id: Section; name: string; icon: string; step: number }[] = [
  { id: 'overview', name: 'Overview', icon: '◫', step: 1 },
  { id: 'products', name: 'Products', icon: '◈', step: 2 },
  { id: 'orders', name: 'Live Orders', icon: '▤', step: 4 },
  { id: 'events', name: 'Events & Menus', icon: '▦', step: 3 },
  { id: 'customers', name: 'Customers', icon: '♙', step: 5 },
  { id: 'reports', name: 'Reports', icon: '◩', step: 5 },
  { id: 'settings', name: 'Settings', icon: '⚙', step: 1 },
];

export default function BusinessWorkspace() {
  const { loading, error, session, signOut } = useBusinessSession();
  const [section, setSection] = useState<Section>('overview');
  const [onboardingStatus, setOnboardingStatus] = useState('');
  const [onboardingError, setOnboardingError] = useState('');
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);

  async function finishOnboarding() {
    if (!adminSupabase || !session || session.role !== 'owner') return;
    setCheckingOnboarding(true);
    setOnboardingError('');
    try {
      const { data: auth } = await adminSupabase.auth.getSession();
      if (!auth.session?.access_token) return;
      const response = await fetch('/api/business-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.session.access_token },
        body: JSON.stringify({ action: 'complete' }),
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Account confirmation service is unavailable (HTTP ' + response.status + '). Please check the preview deployment.');
      }
      const result = await response.json() as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Account confirmation is pending.');
      setOnboardingStatus(result.status || '');
    } catch (err) {
      setOnboardingError(err instanceof Error ? err.message : 'Welcome email is pending; retry when ready.');
    } finally {
      setCheckingOnboarding(false);
    }
  }

  useEffect(() => {
    if (session?.role === 'owner') void finishOnboarding();
  // Trigger only when the verified owner session is loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, session?.brandId]);

  if (!adminBackendConfigured) {
    return (
      <div className="min-h-screen bg-[#f5f3ef] px-5 py-20 text-zinc-900">
        <div className="mx-auto max-w-lg rounded-3xl border border-amber-200 bg-white p-9 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">Preview setup required</span>
          <h1 className="mt-3 text-3xl font-semibold">Connect a test workspace</h1>
          <p className="mt-4 leading-7 text-zinc-600">The admin configuration is missing. Connect this preview to your authorized Supabase project using the existing VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables. Business access is controlled by authenticated membership and database policies.</p>
          <p className="mt-4 text-sm text-zinc-500">No demo credentials are embedded in this application.</p>
          <Link to="/" className="mt-6 inline-block text-sm font-semibold text-emerald-800 underline">Return to BeanBook</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f5f3ef] text-zinc-700">Loading your secure workspace…</div>;
  }
  if (!session) {
    if (!error) return <LoginPanel />;
    return <div className="min-h-screen bg-[#f5f3ef] p-8"><div className="mx-auto mt-16 max-w-lg rounded-3xl bg-white p-8"><h1 className="text-2xl font-semibold">Workspace access unavailable</h1><p role="alert" className="mt-3 text-sm text-red-700">{error}</p><p className="mt-3 text-sm text-zinc-500">Ask a BeanBook administrator to confirm your invitation. An authenticated account alone does not grant business access.</p><button className="mt-6 rounded-xl bg-zinc-900 px-5 py-3 text-white" onClick={()=>void signOut()}>Sign out</button></div></div>;
  }

  const current = nav.find((item) => item.id === section)!;

  return (
    <div className="bb-app-theme min-h-screen bg-[#f5f3ef] text-[#202923] lg:flex">
      <aside className="border-b border-zinc-200 bg-[#1b2822] text-white lg:flex lg:min-h-screen lg:w-64 lg:flex-col lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-5 py-5 lg:px-6 lg:py-7">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">Your business</p>
            <h1 className="truncate text-lg font-semibold tracking-tight" title={session.businessName}>{session.businessName}</h1>
          </div>
          <button type="button" onClick={() => void signOut()} className="shrink-0 rounded-xl border border-white/25 px-3 py-2 text-xs font-medium text-white hover:bg-white/10 sm:text-sm">Sign out</button>
        </div>
        <nav aria-label="Business navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {nav.map((item)=><button key={item.id} onClick={()=>setSection(item.id)} aria-current={section===item.id?'page':undefined} className={'flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition lg:w-full ' + (section === item.id ? 'bg-white/15 font-semibold text-white' : 'text-white/65 hover:bg-white/10 hover:text-white')}>
            <span className="text-base" aria-hidden="true">{item.icon}</span>{item.name}
          </button>)}
        </nav>
        <div className="hidden border-t border-white/10 px-6 py-5 text-xs text-white/60 lg:block">Secure business workspace · Preview</div>
      </aside>
      <div className="min-w-0 flex-1">

        <main className="mx-auto max-w-6xl px-5 py-8 sm:px-9 sm:py-10">
          {onboardingStatus === 'completed' && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">🎉 Welcome aboard! Your Business Admin account is active and your welcome email has been sent.</div>}
          {onboardingError && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">{onboardingError} <button type="button" disabled={checkingOnboarding} className="ml-2 font-semibold underline" onClick={()=>void finishOnboarding()}>Retry welcome email</button></div>}
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6b8974]">{session.businessName} / {current.name}</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">{current.name}</h2></div>

          </div>
          {section==='products' && <ProductsPage />}
          {section==='events' && <MenusPage onReturnToLiveOrders={()=>setSection('orders')} />}
          {section==='customers' && <CustomersPage canEdit={session.role==='owner'} />}
          {section==='orders' && <LiveOrders />}
          {section==='overview' && <>
            <div className="grid gap-4 sm:grid-cols-3">
              {[['Your workspace','Connected','Business access verified'],['Operating locations','Coming in Step 3','Location-based ordering'],['Live order queue','Coming in Step 4','Real-time fulfillment']].map(([label,value,note])=><div key={label} className="rounded-2xl border border-[#e6e3dc] bg-white p-6 shadow-sm"><p className="text-sm text-zinc-500">{label}</p><p className="mt-3 text-xl font-semibold">{value}</p><p className="mt-2 text-xs text-zinc-400">{note}</p></div>)}
            </div>
            <div className="mt-7 rounded-3xl border border-[#e6e3dc] bg-white p-7 sm:p-9">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#688b75]">Getting started</span>
              <h3 className="mt-3 text-2xl font-semibold">Your business, one place.</h3>
              <p className="mt-3 max-w-2xl leading-7 text-zinc-600">Manage your catalogue, customer orders, payment records, events and reporting in one place. Each business has its own private data and customizable customer experience.</p>
              <button onClick={()=>setSection('settings')} className="mt-6 rounded-xl bg-[#1b2822] px-5 py-3 text-sm font-semibold text-white hover:bg-[#304438]">Manage business profile</button>
            </div>
          </>}
          {section==='settings' && <div className="max-w-2xl">
          <div className="rounded-3xl border border-[#e6e3dc] bg-white p-7 sm:p-9">
            <h3 className="text-xl font-semibold">Business profile</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Account identity and business ownership are configured centrally by the BeanBook Platform Administrator.</p>
            <div className="mt-7 space-y-4">
              <div><p className="text-sm font-medium">Display name</p><p className="mt-1 text-zinc-700">{session.businessName}</p></div>
              <div><p className="text-sm font-medium">Signed in as</p><p className="mt-1 text-zinc-700">{session.email} · {session.role}</p></div>
              <p className="rounded-xl bg-[#f5f3ef] px-4 py-3 text-xs leading-6 text-zinc-500">To change business account details, contact your BeanBook platform administrator.</p>
            </div>
          </div>
          <BusinessPaymentSettings />
          </div>}
          {section!=='overview' && section!=='settings' && section!=='products' && section!=='events' && section!=='customers' && section!=='orders' && <div className="rounded-3xl border border-dashed border-[#d5d7d0] bg-white p-10 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eff4ee] text-2xl">{current.icon}</div><h3 className="mt-5 text-xl font-semibold">{current.name} is coming in Step {current.step}</h3><p className="mx-auto mt-3 max-w-md text-sm leading-7 text-zinc-500">This is the shared navigation shell. The module will be built, tested, and enabled in its scheduled step. No dummy orders or fictional sales are displayed.</p></div>}
        </main>
      </div>
    </div>
  );
}
