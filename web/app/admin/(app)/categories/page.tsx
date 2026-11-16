'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Async, Badge, Button, Field, Input, Modal, PageHeader, Table, Toggle, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';

export default function Categories() {
  const { can } = useAdmin();
  const toast = useToast();
  const list = useAsync(() => adminApi.get<any[]>('admin/categories'));
  const [edit, setEdit] = useState<any | null>(null);
  const editable = can('owner', 'ops');

  async function save() {
    try {
      await adminApi.post('admin/categories', { code: edit.code, name: edit.name.trim(), sort: Number(edit.sort || 0), active: edit.active });
      toast.ok('Saved'); setEdit(null); list.reload(true);
    } catch (e) { toast.error(e); }
  }

  return (
    <>
      <PageHeader title="Categories" sub="What shops can say they deal in at sign-up. Customers filter nearby shops by these."
        actions={editable && <Button onClick={() => setEdit({ code: '', name: '', sort: (list.data?.length ?? 0) + 1, active: true, isNew: true })}><Plus size={16} /> Add category</Button>} />
      <Async state={list}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.code} onRow={editable ? (r) => setEdit({ ...r }) : undefined} cols={[
            { key: 'n', label: 'Category', render: (r) => <span className="font-medium">{r.name} {!r.active && <Badge>Hidden</Badge>}</span> },
            { key: 'c', label: 'Code', render: (r) => <span className="font-mono text-xs text-muted">{r.code}</span> },
            { key: 's', label: 'Shops', align: 'right', render: (r) => r.shops },
            { key: 'o', label: 'Order', align: 'right', render: (r) => r.sort },
          ]} />
        )}
      </Async>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? 'New category' : edit?.name} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit?.code || !edit?.name?.trim()} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Modular kitchen" /></Field>
            <Field label="Code" hint="Can’t be changed later"><Input disabled={!edit.isNew} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="kitchen" /></Field>
            <Field label="Order"><Input inputMode="numeric" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: e.target.value })} /></Field>
            <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Show at sign-up" sub="Hiding keeps it on shops that already chose it" />
          </div>
        )}
      </Modal>
    </>
  );
}
