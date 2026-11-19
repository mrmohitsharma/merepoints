'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthLayout } from '@/components/shell';
import { Button, Field, Input, Note } from '@/components/ui';
import { adminApi, ApiError, session } from '@/lib/api';

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      const r = await adminApi.post('admin/auth/login', { username: username.trim(), password });
      session.setToken('admin', r.token);
      router.replace(r.admin.mustChangePassword ? '/admin/account/?first=1' : '/admin/');
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  return (
    <AuthLayout title="Mere Points team" sub="Super Admin login">
      {params.get('expired') && <div className="mb-4"><Note tone="amber">Your session ended. Please log in again.</Note></div>}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <Field label="Username"><Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <p className="text-sm text-bad">{err}</p>}
        <Button className="w-full" size="lg" busy={busy} disabled={!username || !password}>Log in</Button>
        <p className="text-center text-xs text-muted">5 wrong tries locks the account for 15 minutes.</p>
      </form>
    </AuthLayout>
  );
}

export default function Page() { return <Suspense><Login /></Suspense>; }
