'use client';

import { useEffect, useState } from 'react';
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, Note, PageHeader, Select, Textarea, useAsync, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { uploadPhoto } from '@/lib/upload';
import { pts, PROFESSIONS } from '@/lib/format';

type Row = {
  id: number; title: string; body: string; status: string; scheduled_at: string; sent_at: string | null;
  action_type: string; sent: number; pushed: number; delivered: number; opened: number; clicked: number; bought: number;
};
type Detail = Row & { people: { customer_id: number; name: string | null; mobile: string; delivered_at: string | null; opened_at: string | null; clicked_at: string | null; bought: boolean }[] };

const DAYS = [7, 15, 30, 60];
const pct = (a: number, b: number) => (b ? `${Math.round((a * 100) / b)}%` : '0%');
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

export default function Notifications() {
  const list = useAsync<Row[]>(() => merchantApi.get('shop/notifications'), []);
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <>
      <PageHeader
        title="Notifications"
        sub="Send offers and reminders to your carpenters, painters and contractors. See who opened and who tapped."
        actions={<Button onClick={() => setComposing(true)}>New notification</Button>}
      />
      <Async state={list}>
        {(rows) => rows.length === 0 ? (
          <Empty title="No notifications yet" sub="Your first one reaches their phone and their Mere Points inbox." action={<Button onClick={() => setComposing(true)}>Send one</Button>} />
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <Card key={r.id}>
                <button className="w-full text-left" onClick={() => setOpenId(r.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{r.title}</div>
                      <div className="text-sm text-muted">{r.body}</div>
                    </div>
                    <Badge tone={r.status === 'sent' ? 'ok' : r.status === 'cancelled' ? 'bad' : 'amber'}>
                      {r.status === 'scheduled' ? `Scheduled ${when(r.scheduled_at)}` : r.status === 'sent' ? `Sent ${when(r.sent_at)}` : r.status}
                    </Badge>
                  </div>
                  {r.status === 'sent' && (
                    <div className="tabular mt-3 grid grid-cols-4 gap-2 text-center">
                      <Metric label="Sent" v={r.sent} />
                      <Metric label={`Opened · ${pct(r.opened, r.sent)}`} v={r.opened} />
                      <Metric label={r.action_type === 'none' ? 'No button' : `Clicked · ${pct(r.clicked, r.sent)}`} v={r.clicked} />
                      <Metric label={`Bought · ${pct(r.bought, r.sent)}`} v={r.bought} />
                    </div>
                  )}
                </button>
              </Card>
            ))}
          </div>
        )}
      </Async>
      <Compose open={composing} onClose={() => setComposing(false)} onSent={() => { setComposing(false); list.reload(); }} />
      <Insights id={openId} onClose={() => { setOpenId(null); list.reload(); }} />
    </>
  );
}

const Metric = ({ label, v }: { label: string; v: number }) => (
  <div><div className="text-xl font-bold">{pts(v)}</div><div className="text-xs text-muted">{label}</div></div>
);

function Compose({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: () => void }) {
  const { readOnly } = useMerchant();
  const toast = useToast();
  const [visit, setVisit] = useState('');          // in7 / out30 / ''
  const [types, setTypes] = useState<string[]>([]);
  const [expiring, setExpiring] = useState(false);
  const [gift, setGift] = useState(false);
  const [spend, setSpend] = useState('');
  const [mobile, setMobile] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [action, setAction] = useState('none');
  const [label, setLabel] = useState('');
  const [at, setAt] = useState('');
  const [count, setCount] = useState<{ count: number; pushReachable: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const filters = () => {
    const f: Record<string, unknown> = {};
    if (visit) f[visit.startsWith('in') ? 'visitedWithinDays' : 'notVisitedDays'] = Number(visit.slice(visit.startsWith('in') ? 2 : 3));
    if (types.length) f.professions = types;
    if (expiring) f.pointsExpiring = true;
    if (gift) f.canTakeGift = true;
    if (spend) f.spend = spend;
    if (/^\d{10}$/.test(mobile.trim())) f.mobile = mobile.trim();
    return f;
  };
  const key = JSON.stringify(filters());
  useEffect(() => {
    if (!open) return;
    setCount(null);
    merchantApi.post('shop/notifications/audience', JSON.parse(key)).then(setCount).catch(() => setCount({ count: 0, pushReachable: 0 }));
  }, [key, open]);

  async function photo(f?: File) {
    if (!f) return;
    try { setImage(await uploadPhoto('merchant', f, 'ad')); } catch (e) { toast.error(e); }
  }
  async function send() {
    const later = at && new Date(at).getTime() > Date.now() + 120_000;
    if (!confirm(`${later ? 'Schedule' : 'Send'} this to ${count?.count ?? 0} customers? You cannot take it back after it is sent.`)) return;
    setBusy(true);
    try {
      const r = await merchantApi.post('shop/notifications', {
        title: title.trim(), body: body.trim(), ...(image ? { imageUrl: image } : {}),
        action: { type: action, ...(action !== 'none' && label.trim().length >= 2 ? { label: label.trim() } : {}) },
        filters: filters(), ...(later ? { scheduledAt: new Date(at).toISOString() } : {}),
      });
      toast.ok(r.scheduled ? `Scheduled for ${r.recipients} customers` : `Sent to ${r.recipients} customers`);
      setTitle(''); setBody(''); setImage(null); setAt('');
      onSent();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  const toggle = (k: string) => setTypes((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));
  return (
    <Modal open={open} onClose={onClose} title="New notification" wide
      footer={<Button size="lg" busy={busy} disabled={readOnly || !count?.count || title.trim().length < 2 || body.trim().length < 2} onClick={send}>
        {at ? 'Schedule' : 'Send now'} to {count === null ? '…' : pts(count.count)} customers
      </Button>}>
      <div className="space-y-4">
        {readOnly && <Note tone="bad">Your plan has expired. Renew to send notifications.</Note>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Visits">
            <Select value={visit} onChange={(e) => setVisit(e.target.value)}>
              <option value="">Anyone</option>
              {DAYS.map((d) => <option key={`in${d}`} value={`in${d}`}>Visited in the last {d} days</option>)}
              {DAYS.map((d) => <option key={`out${d}`} value={`out${d}`}>Has not visited in {d} days</option>)}
            </Select>
          </Field>
          <Field label="Spend">
            <Select value={spend} onChange={(e) => setSpend(e.target.value)}>
              <option value="">Any</option><option value="top_spenders">Top spenders</option><option value="new_customers">New in last 30 days</option>
            </Select>
          </Field>
        </div>
        <Field label="Work type (pick any)">
          <div className="flex flex-wrap gap-2">
            {Object.entries(PROFESSIONS).map(([k, v]) => (
              <button key={k} type="button" onClick={() => toggle(k)} className={`rounded-full border px-3 py-1 text-sm ${types.includes(k) ? 'border-brand bg-brand/10 font-semibold text-brand' : 'border-line'}`}>{v}</button>
            ))}
          </div>
        </Field>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} /> Points expiring in 30 days</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} /> Enough points for a gift</label>
        </div>
        <Field label="Or one customer's mobile (optional)"><Input inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} /></Field>
        <Note tone="brand">{count === null ? 'Counting…' : `${pts(count.count)} customers match · ${pts(count.pushReachable)} get a phone alert, the rest see it in the app.`}</Note>

        <Field label="Title"><Input maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bonus points offer is live" /></Field>
        <Field label="Message" hint={`${body.length}/240. Use {name} for the first name and {points} for their points.`}>
          <Textarea rows={3} maxLength={240} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Namaste {name}, extra points on every bill this week. You have {points} pts with us." />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Button">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="none">No button</option><option value="shop">Open shop</option><option value="offer">View offer</option><option value="call">Call shop</option>
            </Select>
          </Field>
          {action !== 'none' && <Field label="Button text"><Input maxLength={24} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Open shop" /></Field>}
        </div>
        <Field label="Photo (optional)">
          {image ? <div className="flex items-center gap-3"><img src={image} alt="" className="h-20 rounded-lg" /><Button variant="secondary" onClick={() => setImage(null)}>Remove</Button></div>
            : <input type="file" accept="image/*" onChange={(e) => photo(e.target.files?.[0])} />}
        </Field>
        <Field label="Send later (optional)" hint="Leave empty to send now. Up to 30 days ahead.">
          <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Insights({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    setD(null); setFilter('all');
    if (id) merchantApi.get(`shop/notifications/${id}`).then(setD).catch((e) => { toast.error(e); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  async function cancel() {
    try { await merchantApi.post(`shop/notifications/${id}/cancel`); toast.ok('Cancelled'); onClose(); } catch (e) { toast.error(e); }
  }
  const people = (d?.people ?? []).filter((p) => filter === 'all' || (filter === 'not_opened' && !p.opened_at) || (filter === 'opened' && !!p.opened_at) || (filter === 'clicked' && !!p.clicked_at) || (filter === 'bought' && p.bought));
  const bar = (label: string, v: number, total: number) => (
    <div className="mb-3">
      <div className="flex justify-between text-sm"><span className="font-medium">{label}</span><span className="tabular font-semibold">{pts(v)} · {pct(v, total)}</span></div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-page"><div className="h-full bg-brand" style={{ width: pct(v, total) }} /></div>
    </div>
  );
  return (
    <Modal open={!!id} onClose={onClose} title={d?.title ?? 'How it did'} wide>
      {!d ? <div className="p-6 text-muted">Loading…</div> : (
        <div className="space-y-4">
          <p className="text-muted">{d.body}</p>
          {d.status === 'scheduled' && <Button variant="secondary" onClick={cancel}>Cancel this notification</Button>}
          {d.status === 'sent' && (
            <>
              <div>
                {bar('Sent', d.sent, d.sent)}
                {bar('Delivered to phone', d.delivered, d.sent)}
                {bar('Opened', d.opened, d.sent)}
                {d.action_type !== 'none' && bar('Tapped the button', d.clicked, d.sent)}
                {bar('Bought within 7 days', d.bought, d.sent)}
              </div>
              <div className="flex flex-wrap gap-2">
                {[['all', 'All'], ['not_opened', 'Not opened'], ['opened', 'Opened'], ['clicked', 'Clicked'], ['bought', 'Bought']].map(([k, v]) => (
                  <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-sm ${filter === k ? 'border-brand bg-brand/10 font-semibold text-brand' : 'border-line'}`}>{v}</button>
                ))}
              </div>
              <div className="max-h-72 divide-y divide-line overflow-auto rounded-lg border border-line">
                {people.length === 0 && <div className="p-4 text-center text-muted">Nobody here yet</div>}
                {people.map((p) => (
                  <div key={p.customer_id} className="flex items-center justify-between gap-3 p-3">
                    <div>
                      <div className="font-medium">{p.name ?? p.mobile}</div>
                      <div className="text-xs text-muted">{p.clicked_at ? 'Tapped the button' : p.opened_at ? 'Opened' : p.delivered_at ? 'Delivered, not opened' : 'Not seen yet'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.bought && <Badge tone="ok">Bought</Badge>}
                      {!p.opened_at && <a className="text-sm font-semibold text-brand" href={`tel:+${p.mobile}`}>Call</a>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
