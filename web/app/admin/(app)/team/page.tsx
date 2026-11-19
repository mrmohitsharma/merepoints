'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Async, Badge, Button, Field, Input, Modal, Note, PageHeader, Select, Table, Toggle, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { ROLE_LABEL, useAdmin } from '@/lib/admin';
import type { AdminRole } from '@/lib/admin';
import { ago } from '@/lib/format';

const ROLE_HELP: Record<AdminRole, string> = {
  owner: 'Everything, including prices, settings, the admin team and the audit log',
  ops: 'Approve and suspend shops, add SMS, extend plans, see analytics and payments',
  support: 'Resolve disputes and look up customers. Can view shops but not change them',
};

/** Readable temporary password: the person changes it at first login. */
function tempPassword() {
  const words = ['Ply', 'Teak', 'Laminate', 'Hinge', 'Drill', 'Paint', 'Tile', 'Kettle'];
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  return `${words[a[0] % words.length]}-${words[a[1] % words.length]}-${1000 + (a[2] % 9000)}`;
}

export default function Team() {
  const { admin } = useAdmin();
  const toast = useToast();
  const list = useAsync(() => adminApi.get<any[]>('admin/team'));
  const [create, setCreate] = useState<any | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [shownPw, setShownPw] = useState<{ username: string; password: string } | null>(null);

  async function doCreate() {
    try {
      await adminApi.post('admin/team', { username: create.username, name: create.name, role: create.role, password: create.password });
      setShownPw({ username: create.username, password: create.password });
      setCreate(null); list.reload(true);
    } catch (e) { toast.error(e); }
  }
  async function doUpdate() {
    try {
      await adminApi.patch(`admin/team/${edit.id}`, { name: edit.name, role: edit.role, active: edit.active });
      toast.ok('Saved'); setEdit(null); list.reload(true);
    } catch (e) { toast.error(e); }
  }
  async function reset() {
    const pw = tempPassword();
    if (!confirm(`Reset ${edit.name}'s password? They will be logged out everywhere.`)) return;
    try {
      await adminApi.post(`admin/team/${edit.id}/reset-password`, { password: pw });
      setShownPw({ username: edit.username, password: pw });
      setEdit(null); list.reload(true);
    } catch (e) { toast.error(e); }
  }

  return (
    <>
      <PageHeader title="Admin team" sub="People at Mere Points who can log in here."
        actions={<Button onClick={() => setCreate({ username: '', name: '', role: 'support', password: tempPassword() })}><Plus size={16} /> Add person</Button>} />
      <Async state={list}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.id} onRow={(r) => setEdit({ ...r })} cols={[
            { key: 'n', label: 'Name', render: (r) => <div><div className="font-medium">{r.name}{r.id === admin.id && ' (you)'}</div><div className="text-xs text-muted">@{r.username}</div></div> },
            { key: 'r', label: 'Role', render: (r) => <Badge tone={r.role === 'owner' ? 'brand' : 'muted'}>{ROLE_LABEL[r.role as AdminRole]}</Badge> },
            { key: 's', label: 'Status', render: (r) => !r.active ? <Badge>Removed</Badge> : r.locked ? <Badge tone="bad">Locked</Badge> : r.must_change_password ? <Badge tone="amber">Must set password</Badge> : <Badge tone="ok">Active</Badge> },
            { key: 'l', label: 'Last login', render: (r) => <span className="text-muted">{ago(r.last_login_at)}</span> },
          ]} />
        )}
      </Async>

      <Modal open={!!create} onClose={() => setCreate(null)} title="Add person" footer={<><Button variant="secondary" onClick={() => setCreate(null)}>Cancel</Button><Button disabled={!create?.username || !create?.name} onClick={doCreate}>Create login</Button></>}>
        {create && (
          <div className="space-y-3">
            <Field label="Full name"><Input autoFocus value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} /></Field>
            <Field label="Username" hint="Letters, numbers, dot, dash"><Input value={create.username} onChange={(e) => setCreate({ ...create, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} /></Field>
            <Field label="Role" hint={ROLE_HELP[create.role as AdminRole]}>
              <Select value={create.role} onChange={(e) => setCreate({ ...create, role: e.target.value })}>{(['support', 'ops', 'owner'] as AdminRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
            </Field>
            <Note>A temporary password is created. Share it privately; they must change it when they first log in.</Note>
          </div>
        )}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.name} footer={<><Button variant="secondary" onClick={reset}>Reset password</Button><Button onClick={doUpdate}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Role" hint={ROLE_HELP[edit.role as AdminRole]}>
              <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{(['support', 'ops', 'owner'] as AdminRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
            </Field>
            <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Can log in" sub="Turning off logs them out immediately" />
          </div>
        )}
      </Modal>

      <Modal open={!!shownPw} onClose={() => setShownPw(null)} title="Temporary password" footer={<Button onClick={() => setShownPw(null)}>Done</Button>}>
        {shownPw && (
          <div className="space-y-3">
            <p>Share these with the person privately (not in a group chat). This password is shown only once.</p>
            <div className="rounded-lg bg-page p-4 font-mono">
              <div>Username: <b>{shownPw.username}</b></div>
              <div>Password: <b>{shownPw.password}</b></div>
            </div>
            <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(`Mere Points admin\nUsername: ${shownPw.username}\nTemporary password: ${shownPw.password}`); toast.ok('Copied'); }}>Copy</Button>
          </div>
        )}
      </Modal>
    </>
  );
}
