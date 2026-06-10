'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/Spinner';
import { PriorityBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/client/format.ts';
import { Notice, Section, useAsync, type AdminBox, type TopupRow } from './shared.tsx';

const STATUSES = ['Open', 'In Progress', 'Completed', 'Rejected'] as const;

export function TopupsAdmin() {
  const sb = getSupabaseBrowserClient();
  const [filter, setFilter] = useState<string>('Open');

  const { data, loading, error, reload } = useAsync<{ topups: TopupRow[]; boxes: AdminBox[] }>(async () => {
    const [topups, boxes] = await Promise.all([
      sb.from('topup_requests').select('id, box_id, item_name, reason, priority, status, requested_at, remarks').order('requested_at', { ascending: false }),
      sb.from('boxes').select('id, box_code, box_name, location_description, area, template_id, inspection_frequency_days, is_active'),
    ]);
    return {
      topups: (topups.data ?? []) as unknown as TopupRow[],
      boxes: (boxes.data ?? []) as unknown as AdminBox[],
    };
  });

  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (loading) return <Spinner className="mx-auto my-12 h-7 w-7 text-slate-400" />;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return null;

  const boxCode = new Map(data.boxes.map((b) => [b.id, b.box_code]));
  const rows = data.topups.filter((t) => filter === 'All' || t.status === filter);

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Section title="Top-up requests">
        <select className="select max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="All">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Section>

      {rows.length === 0 && <div className="card p-6 text-center text-slate-500">No requests in this status.</div>}

      {rows.map((t) => (
        <TopupEditor
          key={t.id}
          topup={t}
          boxCode={boxCode.get(t.box_id) ?? '—'}
          onSaved={() => {
            setMsg({ kind: 'ok', text: `Updated ${t.item_name}.` });
            reload();
          }}
          onError={(text) => setMsg({ kind: 'error', text })}
        />
      ))}
    </div>
  );
}

function TopupEditor({
  topup,
  boxCode,
  onSaved,
  onError,
}: {
  topup: TopupRow;
  boxCode: string;
  onSaved: () => void;
  onError: (t: string) => void;
}) {
  const sb = getSupabaseBrowserClient();
  const [status, setStatus] = useState(topup.status);
  const [remarks, setRemarks] = useState(topup.remarks ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const { data: userData } = await sb.auth.getUser();
      const isDone = status === 'Completed';
      const { error } = await sb
        .from('topup_requests')
        .update({
          status,
          remarks: remarks.trim() || null,
          completed_by: isDone ? userData.user?.id ?? null : null,
          completed_at: isDone ? new Date().toISOString() : null,
        })
        .eq('id', topup.id);
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={topup.item_name} actions={topup.priority ? <PriorityBadge priority={topup.priority} /> : null}>
      <p className="text-sm text-slate-600">{topup.reason}</p>
      <p className="text-xs text-slate-400">
        {boxCode} · requested {formatDate(topup.requested_at)}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Status</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as TopupRow['status'])}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Remarks</span>
          <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>
      <button onClick={save} disabled={busy} className="btn btn-md btn-primary mt-3">
        {busy ? <Spinner className="h-4 w-4" /> : 'Update'}
      </button>
    </Section>
  );
}
