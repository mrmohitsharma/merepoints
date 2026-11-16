'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, Field, Input, Note, PageHeader, useToast } from '@/components/ui';
import { adminApi, session } from '@/lib/api';
import { ROLE_LABEL, useAdmin } from '@/lib/admin';

function Account() {
  const { admin } = useAdmin();
  const first = useSearchParams().get('first') || admin.mustChangePassword;
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const strong = f.next.length >= 10 && /[A-Za-z]/.test(f.next) && /\d/.test(f.next);

  async function save() {
    setBusy(true);
    try {
      const r = await adminApi.post('admin/auth/password', { current: f.current, next: f.next });
      session.setToken('admin', r.token);
      toast.ok('Password changed');
      if (first) window.location.href = '/admin/';
      else setF({ current: '', next: '', again: '' });
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="My account" sub={`${admin.name} · @${admin.username} · ${ROLE_LABEL[admin.role]}`} />
      {first && <div className="mb-4 max-w-lg"><Note tone="amber">Set your own password before you continue.</Note></div>}
      <Card className="max-w-lg" title="Change password">
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
          <Field label={first ? 'Temporary password' : 'Current password'}><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
          <Field label="New password" hint="At least 10 characters, with letters and numbers" error={f.next && !strong ? 'Too weak' : undefined}>
            <Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
          </Field>
          <Field label="New password again" error={f.again && f.again !== f.next ? 'Does not match' : undefined}>
            <Input type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
          </Field>
          <Button busy={busy} disabled={!f.current || !strong || f.next !== f.again}>Change password</Button>
          <p className="text-xs text-muted">Changing your password logs you out on other devices.</p>
        </form>
      </Card>
      {!first && <Button variant="ghost" className="mt-4" onClick={() => router.push('/admin/')}>Back to dashboard</Button>}
    </>
  );
}

export default function Page() { return <Suspense><Account /></Suspense>; }
