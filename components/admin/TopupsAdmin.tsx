'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/Spinner';
import { Badge, PriorityBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/client/format.ts';
import { Notice, Section, useAsync, type AdminBox, type TopupRow } from './shared.tsx';

const STATUSES = ['Open', 'In Progress', 'Completed', 'Rejected'] as const;

export function TopupsAdmin() {
  const sb = getSupabaseBrowserClient();
  const [filter, setFilter] = useState<string>('Open');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const { data, loading, error, reload } = useAsync<{ topups: TopupRow[]; boxes: AdminBox[] }>(async () => {
    const [topups, boxes] = await Promise.all([
      sb
        .from('topup_requests')
        .select('id, box_id, item_name, reason, priority, status, requested_at, remarks')
        .order('requested_at', { ascending: false }),
      sb.from('boxes').select('id, box_code, box_name, location_description, area, template_id, inspection_frequency_days, is_active'),
    ]);
    return {
      topups: (topups.data ?? []) as unknown as TopupRow[],
      boxes: (boxes.data ?? []) as unknown as AdminBox[],
    };
  });

  const boxById = useMemo(() => new Map((data?.boxes ?? []).map((b) => [b.id, b])), [data?.boxes]);
  const rows = useMemo(() => {
    const source = data?.topups ?? [];
    return source
      .filter((t) => filter === 'All' || t.status === filter)
      .sort(compareTopups);
  }, [data?.topups, filter]);
  const groups = useMemo(() => groupByBox(rows), [rows]);

  async function bulkUpdate(ids: string[], status: TopupRow['status'], remarks?: string) {
    if (ids.length === 0) {
      setMsg({ kind: 'error', text: 'Select at least one item first.' });
      return;
    }
    setBusyKey(`${status}:${ids.join(',')}`);
    setMsg(null);
    try {
      const { data: userData } = await sb.auth.getUser();
      const done = status === 'Completed';
      const patch: Record<string, unknown> = {
        status,
        completed_by: done ? userData.user?.id ?? null : null,
        completed_at: done ? new Date().toISOString() : null,
      };
      if (remarks) patch.remarks = remarks;

      const { error } = await sb.from('topup_requests').update(patch).in('id', ids);
      if (error) throw new Error(error.message);

      setSelected((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setMsg({
        kind: 'ok',
        text: done ? `Issued ${ids.length} item${ids.length === 1 ? '' : 's'}.` : `Updated ${ids.length} item${ids.length === 1 ? '' : 's'}.`,
      });
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Could not update top-up requests.' });
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <Spinner className="mx-auto my-12 h-7 w-7 text-slate-400" />;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Section title="Top-up requests">
        <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr] md:items-end">
          <label className="block">
            <span className="label">Status</span>
            <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="All">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-slate-600">
            Issue stock by box. Tick the items you are giving out now; leave the rest open if stock is still waiting.
          </p>
        </div>
      </Section>

      {rows.length === 0 && <div className="card p-6 text-center text-slate-500">No requests in this status.</div>}

      <div className="space-y-3">
        {groups.map(([boxId, items]) => {
          const box = boxById.get(boxId);
          const openItems = items.filter((t) => isActiveTopup(t));
          const selectedIds = openItems.filter((t) => selected[t.id]).map((t) => t.id);
          const allOpenSelected = openItems.length > 0 && selectedIds.length === openItems.length;
          const issueSelectedBusy = busyKey === `Completed:${selectedIds.join(',')}`;
          const waitingSelectedBusy = busyKey === `In Progress:${selectedIds.join(',')}`;
          const issueAllBusy = busyKey === `Completed:${openItems.map((t) => t.id).join(',')}`;

          return (
            <section key={boxId} className="card overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold">{box?.box_code ?? boxId}</h2>
                    <Badge tone={openItems.length > 0 ? 'warn' : 'ok'}>{openItems.length} open</Badge>
                  </div>
                  <p className="text-sm text-slate-600">
                    {box?.box_name ?? 'Unknown box'}{box?.area ? ` - ${box.area}` : ''}
                  </p>
                </div>

                {openItems.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-md btn-secondary"
                      onClick={() => toggleIds(openItems.map((t) => t.id), !allOpenSelected, setSelected)}
                    >
                      {allOpenSelected ? 'Clear ticks' : 'Tick all open'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-md btn-secondary"
                      disabled={selectedIds.length === 0 || Boolean(busyKey)}
                      onClick={() => bulkUpdate(selectedIds, 'In Progress', 'Waiting stock')}
                    >
                      {waitingSelectedBusy ? <Spinner className="h-4 w-4" /> : 'Mark waiting stock'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-md bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={selectedIds.length === 0 || Boolean(busyKey)}
                      onClick={() => bulkUpdate(selectedIds, 'Completed')}
                    >
                      {issueSelectedBusy ? <Spinner className="h-4 w-4" /> : `Issue selected (${selectedIds.length})`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-md btn-primary"
                      disabled={openItems.length === 0 || Boolean(busyKey)}
                      onClick={() => bulkUpdate(openItems.map((t) => t.id), 'Completed')}
                    >
                      {issueAllBusy ? <Spinner className="h-4 w-4" /> : 'Issue all open'}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((t) => {
                  const disabled = !isActiveTopup(t);
                  return (
                    <label
                      key={t.id}
                      className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 ${
                        disabled ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-brand"
                        disabled={disabled}
                        checked={Boolean(selected[t.id])}
                        onChange={(e) => toggleIds([t.id], e.target.checked, setSelected)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{t.item_name}</span>
                        <span className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                          {t.priority && <PriorityBadge priority={t.priority} />}
                          <Badge tone={topupStatusTone(t.status)}>{t.status}</Badge>
                          <span>Requested {formatDate(t.requested_at)}</span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const priorityOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const statusOrder: Record<TopupRow['status'], number> = {
  Open: 0,
  'In Progress': 1,
  Completed: 2,
  Rejected: 3,
};

function compareTopups(a: TopupRow, b: TopupRow) {
  const statusDiff = statusOrder[a.status] - statusOrder[b.status];
  if (statusDiff !== 0) return statusDiff;
  const priorityDiff = (priorityOrder[a.priority ?? 'Low'] ?? 3) - (priorityOrder[b.priority ?? 'Low'] ?? 3);
  if (priorityDiff !== 0) return priorityDiff;
  return new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime();
}

function groupByBox(rows: TopupRow[]) {
  const groups = new Map<string, TopupRow[]>();
  for (const row of rows) {
    const list = groups.get(row.box_id) ?? [];
    list.push(row);
    groups.set(row.box_id, list);
  }
  return [...groups.entries()];
}

function isActiveTopup(t: TopupRow) {
  return t.status === 'Open' || t.status === 'In Progress';
}

function topupStatusTone(status: TopupRow['status']) {
  if (status === 'Completed') return 'ok';
  if (status === 'Open') return 'warn';
  return 'neutral';
}

function toggleIds(
  ids: string[],
  checked: boolean,
  setSelected: Dispatch<SetStateAction<Record<string, boolean>>>,
) {
  setSelected((prev) => {
    const next = { ...prev };
    for (const id of ids) {
      if (checked) next[id] = true;
      else delete next[id];
    }
    return next;
  });
}
