'use client';

import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, type AdminUserBody } from '@/lib/client/api.ts';
import type { Role } from '@/lib/client/types.ts';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/StatusBadge';
import { Notice, Section, useAsync, type AdminProfile } from './shared.tsx';

const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'superadmin', label: 'Superadmin' },
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
];

const EMPTY_FORM: AdminUserBody = {
  email: '',
  password: '',
  full_name: '',
  employee_id: '',
  department: '',
  role: 'user',
  is_active: true,
};

export function UsersAdmin() {
  const { data, loading, error, reload } = useAsync<AdminProfile[]>(async () => {
    const res = await api.adminUsers();
    return res.users as unknown as AdminProfile[];
  });
  const [form, setForm] = useState<AdminUserBody>(EMPTY_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (loading) return <Spinner className="mx-auto my-12 h-7 w-7 text-slate-400" />;
  if (error) return <Notice kind="error">{error}</Notice>;

  async function createUser(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setMsg(null);
    try {
      await api.createAdminUser({
        ...form,
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        employee_id: cleanOptional(form.employee_id),
        department: cleanOptional(form.department),
      });
      setForm(EMPTY_FORM);
      setMsg({ kind: 'ok', text: 'User created in Supabase.' });
      await reload();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Could not create user.' });
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(id: string, patch: Partial<Pick<AdminProfile, 'role' | 'is_active'>>) {
    setBusyId(id);
    setMsg(null);
    try {
      await api.updateAdminUser({ id, ...patch });
      setMsg({ kind: 'ok', text: 'User updated.' });
      await reload();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Could not update user.' });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(profile: AdminProfile) {
    const confirmed = window.confirm(`Remove ${profile.full_name} from Supabase? This deletes the login and profile.`);
    if (!confirmed) return;
    setBusyId(profile.id);
    setMsg(null);
    try {
      await api.deleteAdminUser(profile.id);
      setMsg({ kind: 'ok', text: 'User removed from Supabase.' });
      await reload();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Could not remove user.' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Section title="Add user">
        <form onSubmit={createUser} className="grid gap-3 md:grid-cols-2">
          <Field label="Full name">
            <input
              className="input"
              value={form.full_name}
              required
              maxLength={120}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className="input"
              value={form.email}
              required
              maxLength={254}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Temporary password">
            <input
              type="password"
              className="input"
              value={form.password}
              required
              minLength={8}
              maxLength={72}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Employee ID">
            <input
              className="input"
              value={form.employee_id ?? ''}
              maxLength={32}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            />
          </Field>
          <Field label="Department">
            <input
              className="input"
              value={form.department ?? ''}
              maxLength={120}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 accent-green-600"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Active user
          </label>
          <div className="flex items-end md:justify-end">
            <button className="btn btn-md btn-primary" disabled={creating}>
              {creating ? <Spinner className="h-4 w-4" /> : 'Add user'}
            </button>
          </div>
        </form>
      </Section>

      <Section title="Manage users">
        <p className="mb-3 text-xs text-slate-500">
          Superadmin can add/remove Supabase user IDs and manage roles. Admin users do not have access to this tab.
        </p>
        <div className="space-y-2">
          {(data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {p.full_name} {!p.is_active && <Badge tone="neutral">Inactive</Badge>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {p.email ?? 'No email'} - {p.id}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {[p.department, p.employee_id].filter(Boolean).join(' - ') || 'No department'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="select w-auto"
                  value={p.role}
                  disabled={busyId === p.id}
                  onChange={(e) => updateUser(p.id, { role: e.target.value as Role })}
                >
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => updateUser(p.id, { is_active: !p.is_active })}
                  disabled={busyId === p.id}
                  className={`btn btn-md ${p.is_active ? 'btn-secondary' : 'btn-primary'}`}
                >
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => deleteUser(p)}
                  disabled={busyId === p.id}
                  className="btn btn-md btn-secondary text-red-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function cleanOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
