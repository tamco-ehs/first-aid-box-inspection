'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/StatusBadge';
import { Notice, Section, useAsync, type AdminProfile } from './shared.tsx';

const ROLES = ['admin', 'first_aider', 'viewer'] as const;

export function UsersAdmin() {
  const sb = getSupabaseBrowserClient();
  const { data, loading, error, reload } = useAsync<AdminProfile[]>(async () => {
    const { data, error } = await sb
      .from('profiles')
      .select('id, full_name, employee_id, department, email, role, is_active')
      .order('full_name');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AdminProfile[];
  });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (loading) return <Spinner className="mx-auto my-12 h-7 w-7 text-slate-400" />;
  if (error) return <Notice kind="error">{error}</Notice>;

  async function setRole(id: string, role: string) {
    const { error } = await sb.from('profiles').update({ role }).eq('id', id);
    if (error) setMsg({ kind: 'error', text: error.message });
    else {
      setMsg({ kind: 'ok', text: 'Role updated.' });
      reload();
    }
  }
  async function toggleActive(p: AdminProfile) {
    const { error } = await sb.from('profiles').update({ is_active: !p.is_active }).eq('id', p.id);
    if (error) setMsg({ kind: 'error', text: error.message });
    else reload();
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Section title="Users">
        <p className="mb-3 text-xs text-slate-500">
          New accounts are created in the Supabase dashboard (Authentication → Users). They start as
          inactive viewers; activate and set a role here.
        </p>
        <div className="space-y-2">
          {(data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {p.full_name} {!p.is_active && <Badge tone="neutral">Inactive</Badge>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {p.email ?? '—'}
                  {p.department ? ` · ${p.department}` : ''}
                  {p.employee_id ? ` · ${p.employee_id}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select className="select w-auto" value={p.role} onChange={(e) => setRole(p.id, e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button onClick={() => toggleActive(p)} className={`btn btn-md ${p.is_active ? 'btn-secondary' : 'btn-primary'}`}>
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
