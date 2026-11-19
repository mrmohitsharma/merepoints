'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Plus } from 'lucide-react';
import { Async, Badge, Button, Empty, Field, Input, Modal, Note, PageHeader, Select, Table, Tabs, Toggle, useAsync, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { uploadPhoto } from '@/lib/upload';
import { Thumb } from '@/components/thumb';
import { date, inr, n, pts } from '@/lib/format';

type Kind = 'redeem' | 'earn';
const UNITS = ['piece', 'sheet', 'tin', 'bucket', 'pair', 'box', 'bag', 'kg', 'litre', 'metre'];
const CATS = ['Tools', 'Home', 'Safety', 'Plywood', 'Hardware', 'Adhesives', 'Paint', 'Electrical', 'Sanitary', 'Tiles'];

export default function Products() {
  const { shop } = useMerchant();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('redeem');
  const list = useAsync(() => merchantApi.get<any[]>('shop/products'));
  const [edit, setEdit] = useState<any | null>(null);
  const redeem = (list.data ?? []).filter((p) => p.kind === 'redeem');
  const earn = (list.data ?? []).filter((p) => p.kind === 'earn');
  const rows = kind === 'redeem' ? redeem : earn;

  // lowest % of the shop, used for "about ₹X of shopping" hints
  const pct = shop.loyalty.rewardSlabs?.length ? Math.min(...shop.loyalty.rewardSlabs.map((s) => s.percent)) : shop.loyalty.rewardPercent;

  const blank = (k: Kind) => ({ kind: k, name: '', brand: '', category: '', mrpRupees: '', pointsCost: '', stock: '', bonusPoints: '', unit: 'piece', photoUrl: null, availableUntil: '', visible: true });
  const open = (p: any) => setEdit({
    id: p.id, kind: p.kind, name: p.name, brand: p.brand ?? '', category: p.category ?? '', mrpRupees: p.mrp_rupees ?? '', pointsCost: p.points_cost ?? '', stock: p.stock ?? '',
    bonusPoints: p.bonus_points ?? '', unit: p.unit ?? 'piece', photoUrl: p.photo_url, availableUntil: p.available_until ? String(p.available_until).slice(0, 10) : '', visible: p.visible,
  });

  return (
    <>
      <PageHeader title="Products" sub="Gifts customers take for points, and products that earn bonus points when bought. Customers see both in the app."
        actions={<Button onClick={() => setEdit(blank(kind))}><Plus size={16} /> {kind === 'redeem' ? 'Add gift' : 'Add bonus product'}</Button>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={kind} onChange={setKind} items={[{ value: 'redeem', label: `Redeem · ${redeem.length}` }, { value: 'earn', label: `Earn more · ${earn.length}` }]} />
        <span className="text-sm text-muted">{kind === 'redeem' ? 'Out-of-stock gifts are hidden from customers automatically.' : 'Tick these at the Counter when adding a bill. Bonus is fixed: offers and the per-bill cap do not change it.'}</span>
      </div>
      <Async state={list}>
        {() => rows.length === 0
          ? <Empty title={kind === 'redeem' ? 'No gifts yet' : 'No bonus products yet'}
              sub={kind === 'redeem' ? 'A tool bag at 500 points works well to start.' : 'Example: Century ply 18mm, +40 points per sheet.'}
              action={<Button onClick={() => setEdit(blank(kind))}><Plus size={16} /> Add</Button>} />
          : <Table rows={rows} rowKey={(r) => r.id} onRow={open} cols={[
              { key: 'p', label: 'Product', render: (r) => (
                <div className="flex items-center gap-3">
                  <Thumb url={r.photo_url} kind={r.kind} />
                  <div>
                    <div className="font-medium">{r.name} {!r.visible && <Badge>Hidden</Badge>}</div>
                    <div className="text-xs text-muted">{[r.brand, r.category, r.mrp_rupees != null && `MRP ${inr(r.mrp_rupees)}`].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                </div>
              ) },
              ...(kind === 'redeem' ? [
                { key: 'c', label: 'Points', align: 'right' as const, render: (r: any) => <b className="text-brand">{pts(r.points_cost)}</b> },
                { key: 's', label: 'In stock', align: 'right' as const, render: (r: any) => <span className={n(r.stock) === 0 ? 'text-bad' : n(r.stock) <= 3 ? 'text-[#B37400]' : ''}>{pts(r.stock)}</span> },
                { key: 'g', label: 'Given', align: 'right' as const, render: (r: any) => pts(r.given_count) },
              ] : [
                { key: 'b', label: 'Bonus', align: 'right' as const, render: (r: any) => <b className="text-ok">+{pts(r.bonus_points)} / {r.unit}</b> },
                { key: 'u', label: 'Sold with bonus', align: 'right' as const, render: (r: any) => `${pts(r.units_sold_with_bonus)} ${r.unit}` },
              ]),
              { key: 'a', label: 'Until', render: (r) => (r.available_until ? date(r.available_until) : <span className="text-muted">No end</span>) },
            ]} />}
      </Async>

      <ProductModal edit={edit} setEdit={setEdit} pct={pct} pointValue={shop.loyalty.pointValueRupees}
        onSaved={() => { setEdit(null); list.reload(true); toast.ok('Saved'); }} />
    </>
  );
}

function ProductModal({ edit, setEdit, onSaved, pct, pointValue }: { edit: any | null; setEdit: (v: any) => void; onSaved: () => void; pct: number; pointValue: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!edit) return null;
  const redeem = edit.kind === 'redeem';
  const set = (k: string, v: unknown) => setEdit({ ...edit, [k]: v });

  async function save(remove = false) {
    setBusy(true);
    try {
      await merchantApi.post('shop/products', {
        ...(edit.id ? { id: edit.id } : {}), kind: edit.kind, name: edit.name.trim(),
        brand: edit.brand.trim() || null, category: edit.category.trim() || null, photoUrl: edit.photoUrl ?? null,
        mrpRupees: edit.mrpRupees === '' ? null : Number(edit.mrpRupees), availableUntil: edit.availableUntil || null, visible: edit.visible,
        ...(remove ? { active: false } : {}),
        ...(redeem ? { pointsCost: Number(edit.pointsCost) || undefined, stock: edit.stock === '' ? undefined : Number(edit.stock) } : { bonusPoints: Number(edit.bonusPoints) || undefined, unit: edit.unit }),
      });
      onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  async function pick(f?: File) {
    if (!f) return;
    setUploading(true);
    try { set('photoUrl', await uploadPhoto('merchant', f, 'product')); } catch (e) { toast.error(e); } finally { setUploading(false); }
  }

  const cost = Number(edit.pointsCost);
  return (
    <Modal open wide onClose={() => setEdit(null)} title={edit.id ? 'Edit product' : redeem ? 'New gift' : 'New bonus product'}
      footer={<>
        {edit.id && <Button variant="ghost" className="mr-auto text-bad" onClick={() => confirm('Remove this product? Past bills and redemptions stay.') && save(true)}>Remove</Button>}
        <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
        <Button busy={busy} disabled={!edit.name.trim()} onClick={() => save()}>Save</Button>
      </>}>
      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <div>
          <button type="button" onClick={() => file.current?.click()} className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-line bg-page hover:border-brand">
            {uploading ? <Loader2 className="animate-spin text-muted" /> : edit.photoUrl ? <img src={edit.photoUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-sm text-muted"><ImagePlus /> Add photo</span>}
          </button>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <p className="mt-1 text-xs text-muted">Square photo, plain background, under 2 MB.</p>
        </div>
        <div className="space-y-3">
          <Field label="Product name"><Input value={edit.name} onChange={(e) => set('name', e.target.value)} placeholder={redeem ? 'Bosch drill machine' : 'Century ply 18mm'} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand"><Input value={edit.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
            <Field label="MRP (₹)"><Input inputMode="decimal" value={edit.mrpRupees} onChange={(e) => set('mrpRupees', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          </div>
          <Field label="Category">
            <Input list="vp-cats" value={edit.category} onChange={(e) => set('category', e.target.value)} placeholder="Tools" />
            <datalist id="vp-cats">{CATS.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          {redeem ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Points needed"><Input inputMode="numeric" value={edit.pointsCost} onChange={(e) => set('pointsCost', e.target.value.replace(/\D/g, ''))} /></Field>
                <Field label="In stock"><Input inputMode="numeric" value={edit.stock} onChange={(e) => set('stock', e.target.value.replace(/\D/g, ''))} /></Field>
              </div>
              {cost > 0 && pct > 0 && (
                <Note>Worth <b>{inr(cost * pointValue)}</b> to you. A customer earns it with about <b>{inr(Math.ceil((cost * 100) / pct / 100) * 100)}</b> of shopping at your lowest rate ({pct}%).</Note>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bonus points" hint="Per unit, on top of the bill's points"><Input inputMode="numeric" value={edit.bonusPoints} onChange={(e) => set('bonusPoints', e.target.value.replace(/\D/g, ''))} /></Field>
              <Field label="Per"><Select value={edit.unit} onChange={(e) => set('unit', e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
            </div>
          )}
          <Field label="Available till (optional)"><Input type="date" value={edit.availableUntil} onChange={(e) => set('availableUntil', e.target.value)} /></Field>
          <Toggle checked={edit.visible} onChange={(v) => set('visible', v)} label="Show to customers" />
        </div>
      </div>
    </Modal>
  );
}

