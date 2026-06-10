'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client/api.ts';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Me, ReportsResponse } from '@/lib/client/types.ts';
import { downloadCsv, toCsv } from '@/lib/client/csv.ts';
import { formatDate, formatDateTime, todayIso } from '@/lib/client/format.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { Spinner } from '@/components/Spinner';
import { Badge, ItemStatusBadge, OverallBadge, PriorityBadge } from '@/components/StatusBadge';

interface BoxLite {
  id: string;
  box_code: string;
  box_name: string;
  area: string | null;
}

type Tab = 'inspections' | 'issues' | 'topups' | 'usage';

export default function ReportsPage() {
  return <RequireAuth roles={['admin', 'viewer']}>{(me) => <Reports me={me} />}</RequireAuth>;
}

function Reports({ me }: { me: Me }) {
  const [boxes, setBoxes] = useState<BoxLite[]>([]);
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inspections');

  // Filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [boxId, setBoxId] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState('');
  const [issueType, setIssueType] = useState('');

  const boxById = useMemo(() => {
    const m = new Map<string, BoxLite>();
    for (const b of boxes) m.set(b.id, b);
    return m;
  }, [boxes]);

  const areaOptions = useMemo(
    () => [...new Set(boxes.map((b) => b.area).filter(Boolean) as string[])].sort(),
    [boxes],
  );

  async function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (boxId) params.set('box_id', boxId);
    if (area) params.set('area', area);
    if (status) params.set('status', status);
    if (issueType) params.set('issue_type', issueType);
    try {
      const res = await api.reports(params.toString());
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Box list (admin/viewer can read boxes via RLS) powers filters + id->code.
    getSupabaseBrowserClient()
      .from('boxes')
      .select('id, box_code, box_name, area')
      .order('box_code')
      .then(({ data }) => setBoxes((data ?? []) as unknown as BoxLite[]));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insights = useMemo(() => computeInsights(data), [data]);

  return (
    <>
      <AppHeader title="Reports" subtitle={me.full_name} />
      <main className="mx-auto max-w-5xl space-y-5 p-4">
        {/* Dashboard */}
        {data && <Dashboard d={data.dashboard} />}

        {/* Usage vs shortage insight */}
        {insights.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="font-semibold text-amber-900">High consumption items detected</h2>
            <ul className="mt-1 space-y-1 text-sm text-amber-800">
              {insights.map((i) => (
                <li key={i.name}>
                  <strong className="capitalize">{i.name}</strong> — taken {i.usageCount}× and flagged
                  short in {i.shortageCount} inspection{i.shortageCount === 1 ? '' : 's'}.
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Filters */}
        <section className="card p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Field label="From">
              <input type="date" max={todayIso()} className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input type="date" max={todayIso()} className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Box">
              <select className="select" value={boxId} onChange={(e) => setBoxId(e.target.value)}>
                <option value="">All</option>
                {boxes.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.box_code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Area">
              <select className="select" value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">All</option>
                {areaOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                <option>Pass</option>
                <option>Needs Restock</option>
                <option>Fail</option>
              </select>
            </Field>
            <Field label="Item issue">
              <select className="select" value={issueType} onChange={(e) => setIssueType(e.target.value)}>
                <option value="">All</option>
                <option value="expired">Expired</option>
                <option value="expiring_soon">Expiring soon</option>
                <option value="missing">Missing</option>
                <option value="low_stock">Low stock</option>
                <option value="damaged">Damaged</option>
                <option value="topup">Needs top-up</option>
              </select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={load} className="btn btn-md btn-primary">
              Apply filters
            </button>
            <button
              onClick={() => {
                setFrom('');
                setTo('');
                setBoxId('');
                setArea('');
                setStatus('');
                setIssueType('');
                setTimeout(load, 0);
              }}
              className="btn btn-md btn-secondary"
            >
              Reset
            </button>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['inspections', 'Inspections'],
              ['issues', 'Item issues'],
              ['topups', 'Top-ups'],
              ['usage', 'Usage'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`btn btn-md ${tab === key ? 'btn-primary' : 'btn-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        {loading && (
          <div className="flex justify-center py-12 text-slate-400">
            <Spinner className="h-7 w-7" />
          </div>
        )}

        {data && !loading && (
          <>
            {tab === 'inspections' && <InspectionsReport data={data} boxById={boxById} />}
            {tab === 'issues' && <IssuesReport data={data} />}
            {tab === 'topups' && <TopupsReport data={data} boxById={boxById} />}
            {tab === 'usage' && <UsageReport data={data} boxById={boxById} />}
          </>
        )}
      </main>
    </>
  );
}

/* ---------------------------------------------------------------- Dashboard */

function Dashboard({ d }: { d: ReportsResponse['dashboard'] }) {
  const cards: [string, number, 'ok' | 'warn' | 'bad' | 'neutral'][] = [
    ['Total boxes', d.total_boxes, 'neutral'],
    ['Inspected this month', d.boxes_inspected_this_month, 'ok'],
    ['Overdue boxes', d.overdue_boxes, d.overdue_boxes > 0 ? 'bad' : 'ok'],
    ['Needing top-up', d.boxes_needing_topup, d.boxes_needing_topup > 0 ? 'warn' : 'ok'],
    ['With expired items', d.boxes_with_expired_items, d.boxes_with_expired_items > 0 ? 'bad' : 'ok'],
    ['Expiring soon', d.boxes_with_expiring_soon_items, d.boxes_with_expiring_soon_items > 0 ? 'warn' : 'ok'],
    ['Open top-ups', d.open_topup_requests, d.open_topup_requests > 0 ? 'warn' : 'ok'],
    ['Usage this month', d.usage_logs_this_month, 'neutral'],
  ];
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(([label, value, tone]) => (
        <div key={label} className="card p-3">
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-slate-500">{label}</p>
          <span className={`badge mt-1 ${toneToClass(tone)}`}>&nbsp;</span>
        </div>
      ))}
    </section>
  );
}

function toneToClass(t: 'ok' | 'warn' | 'bad' | 'neutral') {
  return t === 'ok' ? 'status-ok' : t === 'warn' ? 'status-warn' : t === 'bad' ? 'status-bad' : 'status-neutral';
}

/* --------------------------------------------------------------- Subreports */

function ExportBar({ onExport }: { onExport: () => void }) {
  return (
    <div className="mb-2 flex justify-end">
      <button onClick={onExport} className="btn btn-md btn-secondary">
        ⬇ Export CSV
      </button>
    </div>
  );
}

function InspectionsReport({
  data,
  boxById,
}: {
  data: ReportsResponse;
  boxById: Map<string, BoxLite>;
}) {
  const rows = data.inspections;
  function exportCsv() {
    const csv = toCsv(rows, [
      { key: 'created_at', label: 'Date', value: (r) => formatDateTime(r.created_at) },
      { key: 'box', label: 'Box', value: (r) => r.boxes?.box_code ?? boxById.get(r.box_id)?.box_code ?? '' },
      { key: 'box_name', label: 'Box name', value: (r) => r.boxes?.box_name ?? '' },
      { key: 'area', label: 'Area', value: (r) => r.boxes?.area ?? '' },
      { key: 'inspector_name', label: 'Inspector' },
      { key: 'inspector_department', label: 'Department' },
      { key: 'overall_status', label: 'Status' },
      { key: 'notes', label: 'Notes' },
    ]);
    downloadCsv(`inspections-${todayIso()}.csv`, csv);
  }

  if (rows.length === 0) return <Empty label="No inspections match these filters." />;
  return (
    <section>
      <ExportBar onExport={exportCsv} />
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{r.boxes?.box_code ?? '—'}</span>
              <OverallBadge status={r.overall_status} />
            </div>
            <p className="text-sm">{r.boxes?.box_name}</p>
            <p className="text-xs text-slate-500">
              {formatDateTime(r.created_at)} · {r.inspector_name}
            </p>
          </div>
        ))}
      </div>
      <Table
        head={['Date', 'Box', 'Area', 'Inspector', 'Status']}
        rows={rows.map((r) => [
          formatDateTime(r.created_at),
          r.boxes?.box_code ?? '—',
          r.boxes?.area ?? '—',
          r.inspector_name,
          <OverallBadge key="s" status={r.overall_status} />,
        ])}
      />
    </section>
  );
}

function IssuesReport({ data }: { data: ReportsResponse }) {
  const rows = data.inspection_items.filter((i) => i.topup_required || i.is_expired || i.expires_soon);
  if (rows.length === 0) return <Empty label="No item issues match these filters." />;
  return (
    <section>
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card flex items-center justify-between p-3">
            <div>
              <p className="font-medium">{r.item_name}</p>
              <p className="text-xs text-slate-500">
                {r.observed_quantity ?? r.observed_volume_level ?? r.observed_present_status ?? '—'}
                {r.expiry_date ? ` · exp ${formatDate(r.expiry_date)}` : ''}
              </p>
            </div>
            {r.item_status && <ItemStatusBadge status={r.item_status} />}
          </div>
        ))}
      </div>
      <Table
        head={['Item', 'Observed', 'Expiry', 'Status']}
        rows={rows.map((r) => [
          r.item_name,
          String(r.observed_quantity ?? r.observed_volume_level ?? r.observed_present_status ?? '—'),
          formatDate(r.expiry_date),
          r.item_status ? <ItemStatusBadge key="s" status={r.item_status} /> : '—',
        ])}
      />
    </section>
  );
}

function TopupsReport({
  data,
  boxById,
}: {
  data: ReportsResponse;
  boxById: Map<string, BoxLite>;
}) {
  const rows = data.topup_requests;
  function exportCsv() {
    const csv = toCsv(rows, [
      { key: 'requested_at', label: 'Requested', value: (r) => formatDateTime(r.requested_at) },
      { key: 'box', label: 'Box', value: (r) => boxById.get(r.box_id)?.box_code ?? r.box_id },
      { key: 'item_name', label: 'Item' },
      { key: 'priority', label: 'Priority' },
      { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason' },
      { key: 'completed_at', label: 'Completed', value: (r) => formatDateTime(r.completed_at) },
    ]);
    downloadCsv(`topups-${todayIso()}.csv`, csv);
  }
  if (rows.length === 0) return <Empty label="No top-up requests match these filters." />;
  return (
    <section>
      <ExportBar onExport={exportCsv} />
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.item_name}</span>
              {r.priority && <PriorityBadge priority={r.priority} />}
            </div>
            <p className="text-xs text-slate-500">
              {boxById.get(r.box_id)?.box_code ?? '—'} · {r.status} · {formatDate(r.requested_at)}
            </p>
          </div>
        ))}
      </div>
      <Table
        head={['Requested', 'Box', 'Item', 'Priority', 'Status']}
        rows={rows.map((r) => [
          formatDate(r.requested_at),
          boxById.get(r.box_id)?.box_code ?? '—',
          r.item_name,
          r.priority ? <PriorityBadge key="p" priority={r.priority} /> : '—',
          <Badge key="s" tone={r.status === 'Completed' ? 'ok' : r.status === 'Open' ? 'warn' : 'neutral'}>
            {r.status}
          </Badge>,
        ])}
      />
    </section>
  );
}

function UsageReport({
  data,
  boxById,
}: {
  data: ReportsResponse;
  boxById: Map<string, BoxLite>;
}) {
  const rows = data.usage_logs;
  function exportCsv() {
    const csv = toCsv(rows, [
      { key: 'created_at', label: 'Date', value: (r) => formatDateTime(r.created_at) },
      { key: 'box', label: 'Box', value: (r) => boxById.get(r.box_id)?.box_code ?? r.box_id },
      { key: 'user_name', label: 'Name' },
      { key: 'department', label: 'Department' },
      { key: 'usage_purpose', label: 'Purpose' },
      { key: 'items_taken', label: 'Items taken', value: (r) => (r.items_taken ?? []).join('; ') },
      { key: 'notes', label: 'Notes' },
    ]);
    downloadCsv(`usage-${todayIso()}.csv`, csv);
  }
  if (rows.length === 0) return <Empty label="No usage logs match these filters." />;
  return (
    <section>
      <ExportBar onExport={exportCsv} />
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card p-3">
            <p className="font-medium">{r.usage_purpose}</p>
            <p className="text-xs text-slate-500">
              {r.user_name} · {r.department} · {boxById.get(r.box_id)?.box_code ?? '—'} · {formatDate(r.created_at)}
            </p>
            {r.items_taken && r.items_taken.length > 0 && (
              <p className="mt-1 text-xs">Items: {r.items_taken.join(', ')}</p>
            )}
          </div>
        ))}
      </div>
      <Table
        head={['Date', 'Box', 'Name', 'Department', 'Purpose', 'Items']}
        rows={rows.map((r) => [
          formatDate(r.created_at),
          boxById.get(r.box_id)?.box_code ?? '—',
          r.user_name,
          r.department,
          r.usage_purpose,
          (r.items_taken ?? []).join(', '),
        ])}
      />
    </section>
  );
}

/* -------------------------------------------------------------------- Bits */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="card p-8 text-center text-slate-500">{label}</div>;
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function computeInsights(data: ReportsResponse | null) {
  if (!data) return [] as { name: string; usageCount: number; shortageCount: number }[];
  const usage = new Map<string, number>();
  for (const u of data.usage_logs) {
    for (const item of u.items_taken ?? []) {
      const k = item.trim().toLowerCase();
      if (k) usage.set(k, (usage.get(k) ?? 0) + 1);
    }
  }
  const shortage = new Map<string, number>();
  for (const it of data.inspection_items) {
    if (it.topup_required) {
      const k = it.item_name.trim().toLowerCase();
      shortage.set(k, (shortage.get(k) ?? 0) + 1);
    }
  }
  const out: { name: string; usageCount: number; shortageCount: number }[] = [];
  for (const [name, usageCount] of usage) {
    const shortageCount = shortage.get(name) ?? 0;
    if (usageCount >= 2 && shortageCount >= 1) out.push({ name, usageCount, shortageCount });
  }
  return out.sort((a, b) => b.usageCount - a.usageCount).slice(0, 8);
}
