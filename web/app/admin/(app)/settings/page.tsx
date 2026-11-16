'use client';

import { useEffect, useState } from 'react';
import { Async, Button, Card, Field, Input, PageHeader, Select, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';

export default function Settings() {
  const toast = useToast();
  const s = useAsync(() => adminApi.get('admin/settings'));
  const plans = useAsync(() => adminApi.get('admin/plans'));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.data) setVals({ ...Object.fromEntries(s.data.editable.map((e: any) => [e.key, String(e.value)])), defaultPlan: s.data.defaultPlan });
  }, [s.data]);

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, number | string> = { defaultPlan: vals.defaultPlan };
      for (const e of s.data.editable) body[e.key] = Number(vals[e.key]);
      await adminApi.put('admin/settings', body);
      toast.ok('Settings saved');
      s.reload(true);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Platform settings" sub="Apply to every shop on Vyapar Point." />
      <Async state={s}>
        {(d: any) => (
          <Card className="max-w-2xl">
            <div className="space-y-4">
              <Field label="Plan for new shops' free trial">
                <Select value={vals.defaultPlan ?? ''} onChange={(e) => setVals({ ...vals, defaultPlan: e.target.value })}>
                  {plans.data?.plans.filter((p: any) => p.active).map((p: any) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </Select>
              </Field>
              {d.editable.map((e: any) => (
                <Field key={e.key} label={e.label} hint={`Between ${e.min} and ${e.max}`}>
                  <Input inputMode="numeric" value={vals[e.key] ?? ''} onChange={(ev) => setVals({ ...vals, [e.key]: ev.target.value.replace(/\D/g, '') })} />
                </Field>
              ))}
              <Button busy={busy} onClick={save}>Save settings</Button>
            </div>
          </Card>
        )}
      </Async>
    </>
  );
}
