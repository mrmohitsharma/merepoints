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
    if (s.data) setVals({ ...Object.fromEntries(s.data.editable.map((e: any) => [e.key, String(e.value)])), defaultPlan: s.data.defaultPlan, defaultPointValueRupees: String(s.data.pointValue?.rupees ?? 0.25), pointValueLocked: s.data.pointValue?.locked ? '1' : '0', inviteAndroidUrl: s.data.invite?.androidUrl ?? '', inviteIosUrl: s.data.invite?.iosUrl ?? '' });
  }, [s.data]);

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, number | string> = { defaultPlan: vals.defaultPlan, defaultPointValueRupees: Number(vals.defaultPointValueRupees), pointValueLocked: vals.pointValueLocked === '1' ? 1 : 0, inviteAndroidUrl: vals.inviteAndroidUrl ?? '', inviteIosUrl: vals.inviteIosUrl ?? '' };
      for (const e of s.data.editable) body[e.key] = Number(vals[e.key]);
      await adminApi.put('admin/settings', body);
      toast.ok('Settings saved');
      s.reload(true);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Platform settings" sub="Apply to every shop on Mere Points." />
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
              <Field label="Value of 1 point (₹)" hint="The default for every shop: new shops start here. Between 0.01 and 100.">
                <Input inputMode="decimal" value={vals.defaultPointValueRupees ?? ''} onChange={(ev) => setVals({ ...vals, defaultPointValueRupees: ev.target.value.replace(/[^\d.]/g, '') })} />
              </Field>
              <label className="flex items-start gap-3 rounded-lg border border-line p-3">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={vals.pointValueLocked === '1'} onChange={(ev) => setVals({ ...vals, pointValueLocked: ev.target.checked ? '1' : '0' })} />
                <span><span className="block font-medium">Lock the point value for all shops</span><span className="block text-sm text-muted">When on, every shop uses this value and owners cannot change it. Points already earned keep the value they were earned at. When off, owners can set their own value.</span></span>
              </label>
              <Field label="App download link: Android (Play Store)" hint="Goes into the WhatsApp invite message that shops, staff and carpenters send. Full link starting with https://">
                <Input value={vals.inviteAndroidUrl ?? ''} onChange={(ev) => setVals({ ...vals, inviteAndroidUrl: ev.target.value })} placeholder="https://play.google.com/store/apps/details?id=..." />
              </Field>
              <Field label="App download link: iPhone (App Store)" hint="Leave empty until the iPhone app is live">
                <Input value={vals.inviteIosUrl ?? ''} onChange={(ev) => setVals({ ...vals, inviteIosUrl: ev.target.value })} placeholder="https://apps.apple.com/app/..." />
              </Field>
              <Button busy={busy} onClick={save}>Save settings</Button>
            </div>
          </Card>
        )}
      </Async>
    </>
  );
}
