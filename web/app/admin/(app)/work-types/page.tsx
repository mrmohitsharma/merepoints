'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Async, Badge, Button, Field, Input, Modal, PageHeader, Table, Toggle, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { pts } from '@/lib/format';

/** Customers pick one at sign-up. Shops target offers and ads by them. */
export default function WorkTypes() {
  const { can } = useAdmin();
  const toast = useToast();
  const list = useAsync(() => adminApi.get<any[]>('admin/professions'));
  const [edit, setEdit] = useState<any | null>(null);
  const editable = can('owner', 'ops');

  async function save() {
    try {
      await adminApi.post('admin/professions', {
        code: edit.code, name: edit.name.trim(), nameHi: edit.name_hi?.trim() || null, sort: Number(edit.sort || 50), active: edit.active,
      });
      toast.ok('Saved. Apps pick it up next time they open.'); setEdit(null); list.reload(true);
    } catch (e) { toast.error(e); }
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

  return (
    <>
      <PageHeader title="Work types" sub="What customers do: carpenter, painter, mason… They choose one at sign-up; shops use it for offers and ads."
        actions={editable && <Button onClick={() => setEdit({ code: '', name: '', name_hi: '', sort: 50, active: true, isNew: true })}><Plus size={16} /> Add work type</Button>} />
      <Async state={list}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.code} onRow={editable ? (r) => setEdit({ ...r }) : undefined} cols={[
            { key: 'n', label: 'Work type', render: (r) => <span className="font-medium">{r.name} {!r.active && <Badge>Hidden</Badge>}</span> },
            { key: 'h', label: 'Hindi', render: (r) => r.name_hi ?? <span className="text-muted">—</span> },
            { key: 'c', label: 'Code', render: (r) => <span className="font-mono text-xs text-muted">{r.code}</span> },
            { key: 'u', label: 'Customers', align: 'right', render: (r) => pts(r.customers) },
            { key: 'o', label: 'Order', align: 'right', render: (r) => r.sort },
          ]} />
        )}
      </Async>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? 'New work type' : edit?.name}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit?.code || !edit?.name?.trim()} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value, ...(edit.isNew ? { code: slug(e.target.value) } : {}) })} placeholder="Glass fitter" /></Field>
            <Field label="Name in Hindi"><Input value={edit.name_hi ?? ''} onChange={(e) => setEdit({ ...edit, name_hi: e.target.value })} placeholder="काँच फिटर" /></Field>
            <Field label="Code" hint={edit.isNew ? 'Small letters and _ only. Cannot change later.' : 'Fixed'}><Input value={edit.code} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, code: slug(e.target.value) })} /></Field>
            <Field label="Order" hint="Lower shows first. 'Other' stays last."><Input inputMode="numeric" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: e.target.value.replace(/\D/g, '') })} /></Field>
            {edit.code !== 'other' && <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Show at sign-up" sub="Hiding keeps existing customers as they are" />}
          </div>
        )}
      </Modal>
    </>
  );
}
