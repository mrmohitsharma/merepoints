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
  const [step, setStep] = useState<'mobile' | 'otp' | 'pick' | 'forgot'>('mobile');
  const [method, setMethod] = useState<'mobile' | 'email'>('mobile');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
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

  /** Common end of every login: keep the token, then pick the shop. */
  function afterLogin(r: any) {
    const list: Shop[] = (r.roles?.shops ?? []).filter((s: Shop) => s.status !== 'rejected');
    if (!list.length) {
      setErr('This account is not linked to any shop. Register your shop in the Mere Points app first, or ask the shop owner to add you as staff.');
      return;
    }
    session.setToken('merchant', r.token);
    if (list.length === 1) return enter(list[0].id);
    setShops(list);
    setStep('pick');
  }

  async function verify() {
    setErr('');
    setBusy(true);
    try {
      afterLogin(await merchantApi.post('auth/verify', { mobile: mobile.replace(/\D/g, '').slice(-10), code }));
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  async function emailLogin() {
    setErr('');
    setBusy(true);
    try {
      afterLogin(await merchantApi.post('auth/email/login', { email: email.trim(), password }));
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  async function sendReset() {
    setErr('');
    setBusy(true);
    try {
      const r = await merchantApi.post('auth/password/forgot', { email: email.trim() });
      if (r.devCode) setCode(r.devCode); // development only
      setSent(true);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  async function resetPassword() {
    setErr('');
    setBusy(true);
    try {
      afterLogin(await merchantApi.post('auth/password/reset', { email: email.trim(), code, password }));
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  function enter(id: number) {
    session.setShopId(id);
    router.replace('/merchant/');
  }

  return (
    <AuthLayout title={step === 'pick' ? 'Choose your shop' : step === 'forgot' ? 'Reset password' : 'Shop login'} sub={step === 'pick' ? 'You work at more than one shop.' : step === 'forgot' ? 'We SMS a code to the mobile number on your account.' : 'Owner or staff: log in with mobile OTP or email.'}>
      {params.get('expired') && step === 'mobile' && <div className="mb-4"><Note tone="amber">Your session ended. Please log in again.</Note></div>}
      {(step === 'mobile') && (
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-page p-1 text-sm font-semibold">
          {(['mobile', 'email'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMethod(m); setErr(''); }} className={`rounded-lg py-2 ${method === m ? 'bg-white text-brand shadow-sm' : 'text-muted'}`}>{m === 'mobile' ? 'Mobile OTP' : 'Email'}</button>
          ))}
        </div>
      )}
      {step === 'mobile' && method === 'email' && (
        <form onSubmit={(e) => { e.preventDefault(); emailLogin(); }} className="space-y-4">
          <Field label="Email"><Input type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@shop.com" /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {err && <p className="text-sm text-bad">{err}</p>}
          <Button className="w-full" size="lg" busy={busy} disabled={!email || !password}>Log in</Button>
          <button type="button" className="block w-full text-center text-sm text-brand" onClick={() => { setStep('forgot'); setSent(false); setPassword(''); setCode(''); setErr(''); }}>Forgot password?</button>
          <p className="text-center text-xs text-muted">No email login yet? Create it in the Mere Points app (Create account with email), then use it here.</p>
        </form>
      )}
      {step === 'forgot' && (
        <form onSubmit={(e) => { e.preventDefault(); sent ? resetPassword() : sendReset(); }} className="space-y-4">
          <Field label="Email"><Input type="email" autoFocus disabled={sent} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {sent && (
            <>
              <Field label="SMS code"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.5em]" /></Field>
              <Field label="New password" hint="8+ characters, a letter and a number"><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            </>
          )}
          {err && <p className="text-sm text-bad">{err}</p>}
          <Button className="w-full" size="lg" busy={busy} disabled={!email || (sent && (code.length !== 6 || !password))}>{sent ? 'Set new password' : 'Send code'}</Button>
          <button type="button" className="block w-full text-center text-sm text-brand" onClick={() => { setStep('mobile'); setErr(''); }}>Back to login</button>
        </form>
      )}
      {step === 'mobile' && method === 'mobile' && (
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
