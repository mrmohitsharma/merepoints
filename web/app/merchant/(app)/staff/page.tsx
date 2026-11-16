'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Async, Badge, Button, Field, Input, Modal, Note, PageHeader, Table, Toggle, useAsync, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { mobile, pts } from '@/lib/format';

export default function Staff() {
  const toast = useToast();
  const list = useAsync(() => merchantApi.get<any[]>('shop/staff'));
  const billing = useAsync(() => merchantApi.get('shop/billing'));
  const [edit, setEdit] = useState<any | null>(null);

  const used = (list.data ?? []).filter((s) => s.role === 'staff' && s.active).length;
  const max = billing.data?.plan?.maxStaff;

  async function save() {
    try {
      if (edit.id) {
        await merchantApi.patch(`shop/staff/${edit.id}`, { active: edit.active, canAddPoints: edit.can_add_points, canRedeem: edit.can_redeem, canManual: edit.can_manual, manualDailyLimit: Number(edit.manual_daily_limit) });
      } else {
        await merchantApi.post('shop/staff', { mobile: edit.mobile, name: edit.name, canRedeem: edit.can_redeem, canManual: edit.can_manual, manualDailyLimit: Number(edit.manual_daily_limit) });
      }
      toast.ok('Saved');
      setEdit(null);
      list.reload(true);
    } catch (e) { toast.error(e); }
  }

  return (
    <>
      <PageHeader title="Staff" sub="Staff log in with their own mobile number. Each entry shows who made it."
        actions={<Button onClick={() => setEdit({ name: '', mobile: '', can_add_points: true, can_redeem: true, can_manual: false, manual_daily_limit: 500, active: true })}><Plus size={16} /> Add staff</Button>} />
      {max !== undefined && (
        <div className="mb-4"><Note tone={used >= max ? 'amber' : 'brand'}>
          {used} of {max} staff logins used on your {billing.data.plan.name} plan.{used >= max && <> <Link href="/merchant/billing/" className="font-semibold underline">Upgrade for more</Link></>}
        </Note></div>
      )}
      <Async state={list}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.id} onRow={(r) => r.role === 'staff' && setEdit({ ...r })} cols={[
            { key: 'n', label: 'Name', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{mobile(r.mobile)}</div></div> },
            { key: 'r', label: 'Role', render: (r) => r.role === 'owner' ? <Badge tone="brand">Owner</Badge> : r.active ? <Badge tone="ok">Staff</Badge> : <Badge>Removed</Badge> },
            { key: 'p', label: 'Can do', render: (r) => r.role === 'owner' ? 'Everything' : [r.can_add_points && 'Add points', r.can_redeem && 'Pay out', r.can_manual && `Manual up to ${pts(r.manual_daily_limit)}/day`].filter(Boolean).join(' · ') },
            { key: 'e', label: 'Entries (7 days)', align: 'right', render: (r) => pts(r.entries_7d) },
          ]} />
        )}
      </Async>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? edit.name : 'Add staff'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            {!edit.id && (
              <>
                <Field label="Name"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                <Field label="Mobile number" hint="They log in with an OTP on this number"><Input inputMode="numeric" maxLength={10} value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value.replace(/\D/g, '') })} /></Field>
              </>
            )}
            {edit.id && <Toggle checked={edit.can_add_points} onChange={(v) => setEdit({ ...edit, can_add_points: v })} label="Add points from bills" />}
            <Toggle checked={edit.can_redeem} onChange={(v) => setEdit({ ...edit, can_redeem: v })} label="Pay out points" sub="Cash, UPI and gifts" />
            <Toggle checked={edit.can_manual} onChange={(v) => setEdit({ ...edit, can_manual: v })} label="Give bonus / manual points" />
            {edit.can_manual && <Field label="Manual points limit per day"><Input inputMode="numeric" value={edit.manual_daily_limit} onChange={(e) => setEdit({ ...edit, manual_daily_limit: e.target.value.replace(/\D/g, '') })} /></Field>}
            {edit.id && <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Can log in" sub="Turn off when someone leaves your shop" />}
          </div>
        )}
      </Modal>
    </>
  );
}
