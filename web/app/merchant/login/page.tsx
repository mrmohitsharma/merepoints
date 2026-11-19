'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthLayout } from '@/components/shell';
import { Button, Field, Input, Note } from '@/components/ui';
import { ApiError, merchantApi, session } from '@/lib/api';

type Shop = { id: number; name: string; status: string; role: string };

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<'mobile' | 'otp' | 'pick'>('mobile');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shops, setShops] = useState<Shop[]>([]);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendOtp() {
    setErr('');
    const m = mobile.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(m)) return setErr('Enter a 10-digit mobile number');
    setBusy(true);
    try {
      const r = await merchantApi.post('auth/otp', { mobile: m });
      if (r.devCode) setCode(r.devCode); // development only
      setStep('otp');
      setResendIn(30);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  async function verify() {
    setErr('');
    setBusy(true);
    try {
      const r = await merchantApi.post('auth/verify', { mobile: mobile.replace(/\D/g, '').slice(-10), code });
      const list: Shop[] = (r.roles?.shops ?? []).filter((s: Shop) => s.status !== 'rejected');
      if (!list.length) {
        setErr('This number is not linked to any shop. Register your shop in the Mere Points app first, or ask the shop owner to add you as staff.');
        return;
      }
      session.setToken('merchant', r.token);
      if (list.length === 1) return enter(list[0].id);
      setShops(list);
      setStep('pick');
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  function enter(id: number) {
    session.setShopId(id);
    router.replace('/merchant/');
  }

  return (
    <AuthLayout title={step === 'pick' ? 'Choose your shop' : 'Shop login'} sub={step === 'pick' ? 'You work at more than one shop.' : 'Owner or staff: log in with your mobile number.'}>
      {params.get('expired') && step === 'mobile' && <div className="mb-4"><Note tone="amber">Your session ended. Please log in again.</Note></div>}
      {step === 'mobile' && (
        <form onSubmit={(e) => { e.preventDefault(); sendOtp(); }} className="space-y-4">
          <Field label="Mobile number">
            <div className="flex">
              <span className="flex h-10 items-center rounded-l-lg border border-r-0 border-line bg-page px-3 text-muted">+91</span>
              <Input autoFocus inputMode="numeric" className="rounded-l-none" value={mobile} maxLength={11} onChange={(e) => setMobile(e.target.value)} placeholder="98765 43210" />
            </div>
          </Field>
          {err && <p className="text-sm text-bad">{err}</p>}
          <Button className="w-full" size="lg" busy={busy}>Get OTP</Button>
        </form>
      )}
      {step === 'otp' && (
        <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-4">
          <Field label={`OTP sent to +91 ${mobile}`}>
            <Input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.5em]" />
          </Field>
          {err && <p className="text-sm text-bad">{err}</p>}
          <Button className="w-full" size="lg" busy={busy} disabled={code.length !== 6}>Log in</Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-brand" onClick={() => { setStep('mobile'); setCode(''); setErr(''); }}>Change number</button>
            <button type="button" className="text-brand disabled:text-muted" disabled={resendIn > 0} onClick={sendOtp}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend OTP'}</button>
          </div>
        </form>
      )}
      {step === 'pick' && (
        <div className="space-y-2">
          {shops.map((s) => (
            <button key={s.id} onClick={() => enter(s.id)} className="flex w-full items-center justify-between rounded-lg border border-line bg-white px-4 py-3 text-left hover:border-brand">
              <span>
                <span className="block font-semibold">{s.name}</span>
                <span className="text-xs text-muted">{s.role === 'owner' ? 'Owner' : 'Staff'}{s.status === 'pending' ? ' · waiting for approval' : ''}</span>
              </span>
              <span className="text-brand">→</span>
            </button>
          ))}
        </div>
      )}
    </AuthLayout>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
