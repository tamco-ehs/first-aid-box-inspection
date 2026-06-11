'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client/api.ts';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Me, ReportsResponse, ReportTopup } from '@/lib/client/types.ts';
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

// Map the dashboard's action-oriented tab names (used in email/KPI deep links)
// onto the report tabs that actually exist.
function mapTab(t: string): Tab {
  if (t === 'topups' || t === 'topup' || t === 'actions') return 'topups';
  if (t === 'issues' || t === 'expiry' || t === 'verification') return 'issues';
  if (t === 'usage') return 'usage';
  return 'inspections';
}

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

  async function load(
    overrides?: Partial<Record<'from' | 'to' | 'box_id' | 'area' | 'status' | 'issue_type', string>>,
  ) {
    setLoading(true);
    setError(null);
    const v = {
      from: overrides?.from ?? from,
      to: overrides?.to ?? to,
      box_id: overrides?.box_id ?? boxId,
      area: overrides?.area ?? area,
      status: overrides?.status ?? status,
      issue_type: overrides?.issue_type ?? issueType,
    };
    const params = new URLSearchParams();
    if (v.from) params.set('from', v.from);
    if (v.to) params.set('to', v.to);
    if (v.box_id) params.set('box_id', v.box_id);
    if (v.area) params.set('area', v.area);
    if (v.status) params.set('status', v.status);
    if (v.issue_type) params.set('issue_type', v.issue_type);
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
    // Deep-link support: /reports?tab=actions&box_id=...&issue_type=expired
    const sp = new URLSearchParams(window.location.search);
    const urlBox = sp.get('box_id') || sp.get('box') || '';
    const urlIssue = sp.get('issue_type') || '';
    const urlTab = sp.get('tab') || '';
    if (urlBox) setBoxId(urlBox);
    if (urlIssue) setIssueType(urlIssue);
    if (urlTab) setTab(mapTab(urlTab));
    load({ box_id: urlBox || undefined, issue_type: urlIssue || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jump from a KPI card to the relevant tab + filter, then refetch.
  function onJump(nextTab: Tab, nextIssue?: string) {
    setTab(nextTab);
    setIssueType(nextIssue ?? '');
    load({ issue_type: nextIssue ?? '' });
  }

  const insights = useMemo(() => computeInsights(data), [data]);

  return (
    <>
      <AppHeader title="Action Dashboard" subtitle={me.full_name} />
      <main className="mx-auto max-w-5xl space-y-5 p-4">
        {/* Dashboard */}
        {data && <Dashboard d={data.dashboard} onJump={onJump} />}

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
            <button onClick={() => load()} className="btn btn-md btn-primary">
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
              ['topups', 'Action queue'],
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
            {tab === 'topups' && (
              <TopupsReport data={data} boxById={boxById} isAdmin={me.role === 'admin'} onChanged={load} />
            )}
            {tab === 'usage' && <UsageReport data={data} boxById={boxById} />}
          </>
        )}
      </main>
    </>
  );
}

/* ---------------------------------------------------------------- Dashboard */

function Dashboard({
  d,
  onJump,
}: {
  d: ReportsResponse['dashboard'];
  onJump: (tab: Tab, issueType?: string) => void;
}) {
  type Card = { label: string; value: number; tone: 'ok' | 'warn' | 'bad' | 'neutral'; jump?: () => void };
  const sev = (n: number, t: 'warn' | 'bad'): 'ok' | 'warn' | 'bad' => (n > 0 ? t : 'ok');

  // Decision cards: "what needs action today", each filtering the queue below.
  const decisionCards: Card[] = [
    { label: 'Critical now', value: d.critical_now, tone: sev(d.critical_now, 'bad'), jump: () => onJump('issues', 'expired') },
    { label: 'Top-up required', value: d.open_topup_requests, tone: sev(d.open_topup_requests, 'warn'), jump: () => onJump('topups') },
    { label: 'Replacement', value: d.items_expired, tone: sev(d.items_expired, 'bad'), jump: () => onJump('issues', 'expired') },
    { label: 'Expiring ≤30d', value: d.items_expiring_within_30_days, tone: sev(d.items_expiring_within_30_days, 'warn'), jump: () => onJump('issues', 'expiring_soon') },
    { label: 'Expiry verification', value: d.items_expiry_verification, tone: sev(d.items_expiry_verification, 'warn'), jump: () => onJump('issues') },
    { label: 'Baseline missing', value: d.items_baseline_missing, tone: sev(d.items_baseline_missing, 'warn'), jump: () => onJump('issues') },
    { label: 'Overdue inspections', value: d.overdue_boxes, tone: sev(d.overdue_boxes, 'bad'), jump: () => onJump('inspections') },
    { label: 'Admin review (photos)', value: d.items_missing_photo, tone: d.items_missing_photo > 0 ? 'warn' : 'neutral' },
  ];
  const contextCards: Card[] = [
    { label: 'Total boxes', value: d.total_boxes, tone: 'neutral' },
    { label: 'Inspected this month', value: d.boxes_inspected_this_month, tone: 'ok' },
    { label: 'Usage this month', value: d.usage_logs_this_month, tone: 'neutral' },
  ];

  const renderCard = (c: Card) => {
    const inner = (
      <>
        <p className="text-2xl font-bold tabular-nums">{c.value}</p>
        <p className="text-xs text-slate-500">{c.label}</p>
        <span className={`badge mt-1 ${toneToClass(c.tone)}`}>&nbsp;</span>
      </>
    );
    return c.jump ? (
      <button
        key={c.label}
        type="button"
        onClick={c.jump}
        className="card p-3 text-left transition hover:border-slate-300 hover:shadow"
      >
        {inner}
      </button>
    ) : (
      <div key={c.label} className="card p-3">
        {inner}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">What needs action today</p>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{decisionCards.map(renderCard)}</section>
      </div>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{contextCards.map(renderCard)}</section>
    </div>
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
  const expiryRows = data.expiry_items;
  if (rows.length === 0 && expiryRows.length === 0) return <Empty label="No item issues match these filters." />;
  return (
    <section className="space-y-4">
      {expiryRows.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">Current expiry reminders</h2>
          <div className="space-y-2 md:hidden">
            {expiryRows.map((r) => (
              <div key={r.id} className="card p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{r.item_name}</p>
                  <Badge tone={r.expiry_status === 'Expired' || r.expiry_status === 'No expiry date recorded' ? 'bad' : 'warn'}>
                    {r.expiry_status}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500">Expiry: {formatDate(r.expiry_date)}</p>
              </div>
            ))}
          </div>
          <Table
            head={['Item', 'Expiry', 'Status', 'Last verified']}
            rows={expiryRows.map((r) => [
              r.item_name,
              formatDate(r.expiry_date),
              <Badge key="s" tone={r.expiry_status === 'Expired' || r.expiry_status === 'No expiry date recorded' ? 'bad' : 'warn'}>
                {r.expiry_status}
              </Badge>,
              formatDate(r.last_verified_date),
            ])}
          />
        </div>
      )}
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
  isAdmin,
  onChanged,
}: {
  data: ReportsResponse;
  boxById: Map<string, BoxLite>;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const rows = data.topup_requests;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function setStatus(id: string, status: ReportTopup['status']) {
    setBusyId(id);
    setActionError(null);
    try {
      const sb = getSupabaseBrowserClient();
      const { data: u } = await sb.auth.getUser();
      const done = status === 'Completed';
      const { error } = await sb
        .from('topup_requests')
        .update({
          status,
          completed_by: done ? u.user?.id ?? null : null,
          completed_at: done ? new Date().toISOString() : null,
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not update.');
    } finally {
      setBusyId(null);
    }
  }

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
  if (rows.length === 0) return <Empty label="No action items match these filters." />;
  return (
    <section>
      <ExportBar onExport={exportCsv} />
      {actionError && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</p>
      )}
      <div className="space-y-2">
        {rows.map((r) => {
          const open = r.status === 'Open' || r.status === 'In Progress';
          return (
            <div key={r.id} className="card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.item_name}</span>
                {r.priority && <PriorityBadge priority={r.priority} />}
              </div>
              {r.reason && <p className="mt-0.5 text-sm text-slate-600">{r.reason}</p>}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{boxById.get(r.box_id)?.box_code ?? '—'}</span>
                <Badge tone={r.status === 'Completed' ? 'ok' : r.status === 'Open' ? 'warn' : 'neutral'}>
                  {r.status}
                </Badge>
                <span>{formatDate(r.requested_at)}</span>
              </p>
              {isAdmin && open && (
                <div className="mt-2 flex gap-2">
                  {r.status === 'Open' && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => setStatus(r.id, 'In Progress')}
                      className="btn btn-md btn-secondary"
                    >
                      Start
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => setStatus(r.id, 'Completed')}
                    className="btn btn-md bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {busyId === r.id ? <Spinner className="h-4 w-4" /> : 'Mark complete'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
