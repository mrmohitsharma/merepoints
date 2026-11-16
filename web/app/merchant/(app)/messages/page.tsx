'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, Field, Note, PageHeader, Select, Textarea, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { pts, PROFESSIONS } from '@/lib/format';

const SEGMENTS: [string, string][] = [
  ['all', 'All my customers'],
  ['inactive_30d', 'Not visited in 30 days'],
  ['expiring_30d', 'Points expiring in 30 days'],
  ['can_afford_gift', 'Have enough points for a gift'],
  ...Object.entries(PROFESSIONS).map(([k, v]) => [`profession:${k}`, `Only ${v.toLowerCase()}s`] as [string, string]),
];
const MAX = 130;

export default function Messages() {
  const { shop, readOnly, refresh } = useMerchant();
  const toast = useToast();
  const [segment, setSegment] = useState('all');
  const [count, setCount] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCount(null);
    merchantApi.get('shop/messages/count', { segment }).then((r) => setCount(r.count)).catch(() => setCount(0));
  }, [segment]);

  const enough = count !== null && shop.sms_balance >= count;
  async function send() {
    if (!confirm(`Send this SMS to ${count} customers? It uses ${count} SMS credits.`)) return;
    setBusy(true);
    try {
      const r = await merchantApi.post('shop/messages', { segment, text: text.trim() });
      toast.ok(`Sending to ${r.sent} customers`);
      setText('');
      refresh();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="SMS customers" sub="Tell your customers about offers, new stock or points about to expire." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <div className="space-y-4">
            <Field label="Send to"><Select value={segment} onChange={(e) => setSegment(e.target.value)}>{SEGMENTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Message" hint={`${text.length}/${MAX} characters. Use {name} for the customer's first name and {points} for their points.`}>
              <Textarea rows={4} maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder="Namaste {name}, Diwali offer at Sharma Ply: 1.5x points till 10 Nov. You have {points} points." />
            </Field>
            <div className="rounded-lg bg-page p-3 text-sm"><span className="text-muted">Preview: </span>{(text || '…').replaceAll('{name}', 'Ramesh').replaceAll('{points}', '1,250')} -Vyapar Point</div>
            {readOnly && <Note tone="bad">Your plan has expired. Renew to send SMS.</Note>}
            {!readOnly && count !== null && !enough && <Note tone="amber">You need {pts(count)} SMS but have {pts(shop.sms_balance)}. <Link href="/merchant/billing/" className="font-semibold underline">Buy an SMS pack</Link></Note>}
            <Button size="lg" busy={busy} disabled={readOnly || !count || !enough || text.trim().length < 5} onClick={send}>
              Send to {count === null ? '…' : pts(count)} customers
            </Button>
          </div>
        </Card>
        <Card title="SMS balance">
          <div className="tabular text-3xl font-bold">{pts(shop.sms_balance)}</div>
          <p className="mt-1 text-muted">1 SMS per customer. Points and payout SMS to customers are free and don’t use this balance.</p>
          <Link href="/merchant/billing/"><Button variant="secondary" className="mt-4 w-full">Buy more SMS</Button></Link>
        </Card>
      </div>
    </>
  );
}
