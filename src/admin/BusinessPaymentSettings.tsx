import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminSupabase } from './client';

type PaymentChoice = 'self_upi' | 'gateway';
type BusinessMenuResponse = { paymentSettings: { upi_vpa: string; payee_name: string } | null };
const field = 'mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#3d6248] focus:ring-2 focus:ring-emerald-100';
const selected = 'border-[#365841] bg-[#eff6ef] ring-1 ring-[#365841]';
const unselected = 'border-zinc-200 bg-white hover:border-[#bac8bd]';

export default function BusinessPaymentSettings() {
  const [billingMode,setBillingMode]=useState<'pay_first'|'open_bill'>('pay_first');
  const [billingBusy,setBillingBusy]=useState(false);
  const [billingMessage,setBillingMessage]=useState('');
  const [choice, setChoice] = useState<PaymentChoice>('self_upi');
  const [upi, setUpi] = useState('');
  const [payee, setPayee] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const request = useCallback(async (payload?: Record<string, unknown>): Promise<BusinessMenuResponse> => {
    if (!adminSupabase) throw new Error('Business connection unavailable.');
    const { data: auth } = await adminSupabase.auth.getSession();
    if (!auth.session?.access_token) throw new Error('Your session expired. Please sign in again.');
    const response = await fetch('/api/business-products?mode=menus', {
      method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + auth.session.access_token,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new Error('Payment settings are unavailable (HTTP ' + response.status + ').');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load payment settings.');
    return result;
  }, []);

  useEffect(() => {
    let active=true;
    void (async()=>{try{const auth=await adminSupabase?.auth.getSession();const token=auth?.data.session?.access_token;if(!token)return;const r=await fetch('/api/business-orders',{headers:{Authorization:'Bearer '+token}});if(r.ok){const d=await r.json();if(active)setBillingMode(d.billingMode==='open_bill'?'open_bill':'pay_first');}}catch{ /* existing payments remain available */ }})();
    return()=>{active=false;};
  },[]);

  useEffect(() => {
    let active = true;
    void request().then((result) => {
      if (!active) return;
      setUpi(result.paymentSettings?.upi_vpa || '');
      setPayee(result.paymentSettings?.payee_name || '');
      setSaved(Boolean(result.paymentSettings));
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load payment settings.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [request]);

  async function saveUPI(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request({ action: 'savePaymentSettings', upiVpa: upi.trim(), payeeName: payee.trim() });
      setUpi(upi.trim());
      setPayee(payee.trim());
      setSaved(true);
      setMessage('Self UPI details saved for your business. New counter orders can use this payment account.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save UPI details.');
    } finally {
      setBusy(false);
    }
  }

  async function saveBilling(mode:'pay_first'|'open_bill'){
    if(billingBusy)return;
    setBillingBusy(true);setBillingMessage('');
    try{const auth=await adminSupabase?.auth.getSession();const token=auth?.data.session?.access_token;if(!token)throw new Error('Sign in again');
      const r=await fetch('/api/business-orders',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'saveBillingMode',billingMode:mode})});
      const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not save billing mode');setBillingMode(mode);setBillingMessage('Saved. This applies only to new orders.');
    }catch(e){setBillingMessage(e instanceof Error?e.message:'Could not save');}finally{setBillingBusy(false);}
  }

  return <section aria-labelledby="payment-settings-title" className="mt-6 space-y-5 rounded-3xl border border-[#e6e3dc] bg-white p-6 shadow-sm sm:p-8">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6b8974]">Checkout configuration</p>
      <h3 id="payment-settings-title" className="mt-2 text-xl font-semibold">Payment settings</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-600">Choose how your café accepts payments at the counter. These settings belong to this business, not an individual menu.</p>
    </div>
    <div className="rounded-2xl border border-[#dfe7dd] bg-[#f7faf5] p-5"><h4 className="font-semibold">When should customers pay?</h4><p className="mt-2 text-sm text-zinc-600">The choice applies to new counter orders. Existing bills retain their original policy.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{([['pay_first','Pay First','Payment before preparation'],['open_bill','Open Bill · Pay Later','Keep adding items, then settle']] as const).map(([value,name,subtitle])=><button key={value} type="button" disabled={billingBusy} onClick={()=>void saveBilling(value)} className={'rounded-xl border-2 p-4 text-left '+(billingMode===value?'border-[#315b3c] bg-[#edf5eb]':'border-zinc-200 bg-white')}><strong className="block">{name}</strong><span className="mt-1 block text-xs text-zinc-600">{subtitle}</span></button>)}</div>{billingMessage&&<p role="status" className="mt-3 text-sm">{billingMessage}</p>}</div>
    <div role="radiogroup" aria-label="Payment method" className="grid gap-3 sm:grid-cols-2">
      <button type="button" role="radio" aria-checked={choice === 'self_upi'} onClick={() => { setChoice('self_upi'); setError(''); setMessage(''); }}
        className={'rounded-2xl border p-4 text-left transition ' + (choice === 'self_upi' ? selected : unselected)}>
        <div className="flex items-center justify-between gap-2"><span className="font-semibold">Self UPI</span><span aria-hidden="true" className={'flex h-5 w-5 items-center justify-center rounded-full border-2 ' + (choice === 'self_upi' ? 'border-[#365841]' : 'border-zinc-400')}>{choice === 'self_upi' && <span className="h-2.5 w-2.5 rounded-full bg-[#365841]"/>}</span></div>
        <p className="mt-2 text-sm leading-5 text-zinc-600">Collect payments directly into your café's UPI account using an exact-amount QR.</p>
      </button>
      <button type="button" role="radio" aria-checked={choice === 'gateway'} onClick={() => { setChoice('gateway'); setError(''); setMessage(''); }}
        className={'rounded-2xl border p-4 text-left transition ' + (choice === 'gateway' ? selected : unselected)}>
        <div className="flex items-center justify-between gap-2"><span className="font-semibold">Payment Gateway</span><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">Coming soon</span></div>
        <p className="mt-2 text-sm leading-5 text-zinc-600">Integrated online payment processing and automatic confirmation.</p>
      </button>
    </div>
    {choice === 'gateway'
      ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h4 className="font-semibold text-amber-950">Payment Gateway is under development</h4>
          <p className="mt-2 text-sm leading-6 text-amber-900">Gateway setup and checkout are not yet available. Selecting this option is only a preview; it does not change your live payment configuration. Self UPI and cash remain available in the POS.</p>
        </div>
      : loading
        ? <p className="rounded-2xl bg-[#f5f3ef] p-5 text-sm text-zinc-500">Loading payment details…</p>
        : <form onSubmit={(event) => void saveUPI(event)} className="space-y-4 rounded-2xl border border-zinc-200 bg-[#faf9f6] p-5">
            <div><h4 className="font-semibold">Self UPI setup</h4><p className="mt-1 text-sm leading-6 text-zinc-600">Enter the receiving UPI ID and payee name exactly as shown in your bank or UPI app.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">UPI ID
                <input className={field} value={upi} onChange={event => { setUpi(event.target.value); setMessage(''); }} placeholder="cafe@bank" autoCapitalize="none" autoComplete="off" required maxLength={170}/>
              </label>
              <label className="block text-sm font-medium">Account / Payee name
                <input className={field} value={payee} onChange={event => { setPayee(event.target.value); setMessage(''); }} placeholder="Your café's receiving name" required minLength={2} maxLength={120}/>
              </label>
            </div>
            {saved && <p className="text-xs text-zinc-500">This business already has Self UPI details configured. Saving here updates the same details for its counter menus.</p>}
            <button type="submit" disabled={busy} className="rounded-xl bg-[#1b2822] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save UPI Details'}</button>
          </form>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
  </section>;
}
