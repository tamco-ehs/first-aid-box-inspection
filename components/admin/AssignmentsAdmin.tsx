'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/StatusBadge';
import { Notice, Section, useAsync, type AdminBox, type AdminProfile } from './shared.tsx';

interface Assignment {
  id: string;
  box_id: string;
  profile_id: string;
  is_primary_responsible: boolean;
}

interface Bundle {
  boxes: AdminBox[];
  aiders: AdminProfile[];
  assignments: Assignment[];
}

export function AssignmentsAdmin() {
  const sb = getSupabaseBrowserClient();
  const { data, loading, error, reload } = useAsync<Bundle>(async () => {
    const [boxes, aiders, assignments] = await Promise.all([
      sb.from('boxes').select('id, box_code, box_name, location_description, area, template_id, inspection_frequency_days, is_active').eq('is_active', true).order('box_code'),
      sb.from('profiles').select('id, full_name, employee_id, department, email, role, is_active').eq('role', 'user').eq('is_active', true).order('full_name'),
      sb.from('box_assignments').select('id, box_id, profile_id, is_primary_responsible').eq('is_active', true),
    ]);
    return {
      boxes: (boxes.data ?? []) as unknown as AdminBox[],
      aiders: (aiders.data ?? []) as unknown as AdminProfile[],
      assignments: (assignments.data ?? []) as unknown as Assignment[],
    };
  });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (loading) return <Spinner className="mx-auto my-12 h-7 w-7 text-slate-400" />;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return null;

  const aiderById = new Map(data.aiders.map((a) => [a.id, a]));

  async function add(boxId: string, profileId: string) {
    if (!profileId) return;
    const { error } = await sb.from('box_assignments').insert({ box_id: boxId, profile_id: profileId });
    if (error) setMsg({ kind: 'error', text: error.message });
    else {
      setMsg({ kind: 'ok', text: 'User assigned.' });
      reload();
    }
  }
  async function remove(id: string) {
    const { error } = await sb.from('box_assignments').update({ is_active: false }).eq('id', id);
    if (error) setMsg({ kind: 'error', text: error.message });
    else reload();
  }
  async function setPrimary(boxId: string, assignmentId: string) {
    // exactly one primary per box
    await sb.from('box_assignments').update({ is_primary_responsible: false }).eq('box_id', boxId).eq('is_active', true);
    const { error } = await sb.from('box_assignments').update({ is_primary_responsible: true }).eq('id', assignmentId);
    if (error) setMsg({ kind: 'error', text: error.message });
    else reload();
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {data.aiders.length === 0 && (
        <Notice kind="error">No active users found. Add users with the User role first.</Notice>
      )}
      {data.boxes.map((box) => {
        const rows = data.assignments.filter((a) => a.box_id === box.id);
        const assignedIds = new Set(rows.map((r) => r.profile_id));
        const available = data.aiders.filter((a) => !assignedIds.has(a.id));
        return (
          <Section key={box.id} title={`${box.box_code} — ${box.box_name}`}>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">No user assigned.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const a = aiderById.get(r.profile_id);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-medium">{a?.full_name ?? 'Unknown'}</p>
                        <p className="text-xs text-slate-500">{a?.department ?? ''}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.is_primary_responsible ? (
                          <Badge tone="ok">Primary</Badge>
                        ) : (
                          <button onClick={() => setPrimary(box.id, r.id)} className="text-xs font-semibold text-brand">
                            Set primary
                          </button>
                        )}
                        <button onClick={() => remove(r.id)} className="text-xs font-semibold text-red-600">
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {available.length > 0 && (
              <div className="mt-3">
                <select
                  className="select"
                  defaultValue=""
                  onChange={(e) => {
                    add(box.id, e.target.value);
                    e.target.value = '';
                  }}
                >
                  <option value="">+ Assign a user...</option>
                  {available.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}
                      {a.department ? ` (${a.department})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Section>
        );
      })}
    </div>
  );
}
