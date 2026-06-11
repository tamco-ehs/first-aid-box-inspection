'use client';

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
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

  // Jump from a KPI card to the relevant tab + filter. No refetch - the data is
  // already loaded, so this filters client-side and is instant.
  function onJump(nextTab: Tab, nextIssue?: string) {
    setTab(nextTab);
    setIssueType(nextIssue ?? '');
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
                  <strong className="capitalize">{i.name}</strong> was taken {i.usageCount} times and flagged
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
            {tab === 'issues' && <IssuesReport data={data} issueType={issueType} boxById={boxById} />}
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
  type Card = {
    label: string;
    value: number;
    tone: 'ok' | 'warn' | 'bad' | 'neutral';
    hint: string;
    jump?: () => void;
  };
  const sev = (n: number, t: 'warn' | 'bad'): 'ok' | 'warn' | 'bad' => (n > 0 ? t : 'ok');

  // Decision cards: "what needs action today", each filtering the queue below.
  const decisionCards: Card[] = [
    {
      label: 'Critical now',
      value: d.critical_now,
      tone: sev(d.critical_now, 'bad'),
      hint: 'Expired critical items',
      jump: () => onJump('issues', 'expired'),
    },
    {
      label: 'Top-up required',
      value: d.open_topup_requests,
      tone: sev(d.open_topup_requests, 'warn'),
      hint: 'Open action queue',
      jump: () => onJump('topups'),
    },
    {
      label: 'Replacement',
      value: d.items_expired,
      tone: sev(d.items_expired, 'bad'),
      hint: 'Expired inventory',
      jump: () => onJump('issues', 'expired'),
    },
    {
      label: 'Expiring <=30d',
      value: d.items_expiring_within_30_days,
      tone: sev(d.items_expiring_within_30_days, 'warn'),
      hint: 'Plan before month end',
      jump: () => onJump('issues', 'expiring_soon'),
    },
    {
      label: 'Expiry verification',
      value: d.items_expiry_verification,
      tone: sev(d.items_expiry_verification, 'warn'),
      hint: 'Label mismatch',
      jump: () => onJump('issues'),
    },
    {
      label: 'Baseline missing',
      value: d.items_baseline_missing,
      tone: sev(d.items_baseline_missing, 'warn'),
      hint: 'No expiry date saved',
      jump: () => onJump('issues'),
    },
    {
      label: 'Overdue inspections',
      value: d.overdue_boxes,
      tone: sev(d.overdue_boxes, 'bad'),
      hint: 'Boxes past due',
      jump: () => onJump('inspections'),
    },
    {
      label: 'Admin review',
      value: d.items_missing_photo,
      tone: d.items_missing_photo > 0 ? 'warn' : 'neutral',
      hint: 'Items missing photos',
    },
  ];
  const contextCards: Card[] = [
    { label: 'Total boxes', value: d.total_boxes, tone: 'neutral', hint: 'Active coverage' },
    { label: 'Inspected this month', value: d.boxes_inspected_this_month, tone: 'ok', hint: 'Completed rounds' },
    { label: 'Usage this month', value: d.usage_logs_this_month, tone: 'neutral', hint: 'Medicine taken' },
  ];

  const renderCard = (c: Card) => {
    const badge =
      c.tone === 'bad' ? 'Act now' : c.tone === 'warn' ? 'Plan' : c.tone === 'ok' ? 'Clear' : 'Info';
    const inner = (
      <>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-2xl font-bold tabular-nums">{c.value}</p>
            <p className="text-xs font-semibold text-slate-700">{c.label}</p>
          </div>
          <span className={`badge ${toneToClass(c.tone)}`}>{badge}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">{c.hint}</p>
      </>
    );
    return c.jump ? (
      <button
        key={c.label}
        type="button"
        onClick={c.jump}
        className="card p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow"
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
      <div className="card border-brand/20 bg-white p-4">
        <p className="text-xs font-semibold uppercase text-brand">Decision view</p>
        <h2 className="mt-1 text-lg font-bold">What needs action today</h2>
        <p className="mt-1 text-sm text-slate-600">
          Start with red cards, then work through the amber planning items.
        </p>
        <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {decisionCards.map(renderCard)}
        </section>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">Context</p>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">{contextCards.map(renderCard)}</section>
      </div>
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
        Export CSV
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
  const inspectionStatus = {
    restock: rows.filter((r) => r.overall_status === 'Needs Restock').length,
    fail: rows.filter((r) => r.overall_status === 'Fail').length,
    boxes: new Set(rows.map((r) => r.box_id)).size,
  };
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
    <section className="space-y-4">
      <ExportBar onExport={exportCsv} />
      <ReportSummary
        items={[
          { label: 'Inspections', value: rows.length, tone: 'neutral' },
          { label: 'Boxes covered', value: inspectionStatus.boxes, tone: 'neutral' },
          { label: 'Need restock', value: inspectionStatus.restock, tone: inspectionStatus.restock > 0 ? 'warn' : 'ok' },
          { label: 'Failed', value: inspectionStatus.fail, tone: inspectionStatus.fail > 0 ? 'bad' : 'ok' },
        ]}
      />
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{r.boxes?.box_code ?? '-'}</span>
              <OverallBadge status={r.overall_status} />
            </div>
            <p className="text-sm">{r.boxes?.box_name}</p>
            <p className="text-xs text-slate-500">
              {formatDateTime(r.created_at)} - {r.inspector_name}
            </p>
            <a
              href={inspectionPdfHref(r.id)}
              download
              className="btn btn-md btn-secondary mt-3 w-full"
              aria-label={`Download audit PDF for inspection ${r.id}`}
            >
              Download audit PDF
            </a>
          </div>
        ))}
      </div>
      <Table
        head={['Date', 'Box', 'Area', 'Inspector', 'Status', 'Audit PDF']}
        rows={rows.map((r) => [
          formatDateTime(r.created_at),
          r.boxes?.box_code ?? '-',
          r.boxes?.area ?? '-',
          r.inspector_name,
          <OverallBadge key="s" status={r.overall_status} />,
          <a key="pdf" href={inspectionPdfHref(r.id)} download className="btn btn-md btn-secondary">
            PDF
          </a>,
        ])}
      />
    </section>
  );
}

function IssuesReport({
  data,
  issueType,
  boxById,
}: {
  data: ReportsResponse;
  issueType: string;
  boxById: Map<string, BoxLite>;
}) {
  let rows = data.inspection_items.filter((i) => i.topup_required || i.is_expired || i.expires_soon);
  let expiryRows = data.expiry_items;
  if (issueType === 'expired') {
    rows = rows.filter((i) => i.is_expired);
    expiryRows = expiryRows.filter((e) => e.expiry_status === 'Expired');
  } else if (issueType === 'expiring_soon') {
    rows = rows.filter((i) => i.expires_soon);
    expiryRows = expiryRows.filter((e) => e.expiry_status === 'Expiring soon');
  } else if (issueType === 'missing') {
    rows = rows.filter((i) => i.item_status === 'Missing');
    expiryRows = [];
  } else if (issueType === 'low_stock') {
    rows = rows.filter((i) => i.item_status === 'Low Stock');
    expiryRows = [];
  } else if (issueType === 'damaged') {
    rows = rows.filter((i) => i.item_status === 'Damaged');
    expiryRows = [];
  } else if (issueType === 'topup') {
    rows = rows.filter((i) => i.topup_required);
  }

  const affectedBoxes = new Set([
    ...expiryRows.map((r) => r.box_id),
    ...rows.map((r) => r.box_id).filter(Boolean),
  ]).size;
  const replacementCount =
    expiryRows.filter((r) => r.expiry_status === 'Expired').length + rows.filter((r) => r.is_expired).length;
  const verificationCount =
    expiryRows.filter((r) => r.expiry_status === 'No expiry date recorded' || r.expiry_status === 'Expiry label mismatch')
      .length + rows.filter((r) => r.expiry_label_mismatch || r.no_expiry_date_recorded).length;
  const topupCount = rows.filter((r) => r.topup_required).length;

  if (rows.length === 0 && expiryRows.length === 0) return <Empty label="No item issues match these filters." />;
  return (
    <section className="space-y-4">
      <ReportSummary
        items={[
          { label: 'Boxes affected', value: affectedBoxes, tone: affectedBoxes > 0 ? 'warn' : 'ok' },
          { label: 'Replace now', value: replacementCount, tone: replacementCount > 0 ? 'bad' : 'ok' },
          { label: 'Top-up signals', value: topupCount, tone: topupCount > 0 ? 'warn' : 'ok' },
          { label: 'Verify expiry', value: verificationCount, tone: verificationCount > 0 ? 'warn' : 'ok' },
        ]}
      />

      {expiryRows.length > 0 && (
        <div className="space-y-2">
          <SectionTitle
            title="Current inventory reminders"
            subtitle="Grouped by box so stock can be prepared and issued in one trip."
          />
          {groupExpiryByBox(expiryRows).map(([boxId, items]) => {
            const box = boxById.get(boxId);
            const urgent = items.filter((r) => expiryTone(r.expiry_status) === 'bad').length;
            return (
              <div key={boxId} className="card overflow-hidden">
                <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-bold">{boxLabel(box, boxId)}</h3>
                    <p className="text-sm text-slate-600">
                      {box?.box_name ?? 'Unknown box'}{box?.area ? ` - ${box.area}` : ''}
                    </p>
                  </div>
                  <Badge tone={urgent > 0 ? 'bad' : 'warn'}>
                    {items.length} item{items.length === 1 ? '' : 's'}
                  </Badge>
                </div>
                <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{r.item_name}</span>
                        <Badge tone={expiryTone(r.expiry_status)}>{r.expiry_status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Exp {formatDate(r.expiry_date)}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          <SectionTitle
            title="Issues found during inspection"
            subtitle="Compact item names grouped by box. Use this as the practical issue list."
          />
          {groupInspectionIssuesByBox(rows).map(([boxId, items]) => {
            const box = boxById.get(boxId);
            return (
              <div key={boxId} className="card overflow-hidden">
                <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-bold">{boxLabel(box, boxId)}</h3>
                    <p className="text-sm text-slate-600">
                      {box?.box_name ?? 'Unknown box'}{box?.area ? ` - ${box.area}` : ''}
                    </p>
                  </div>
                  <Badge tone={items.some((r) => r.is_expired || r.item_status === 'Missing') ? 'bad' : 'warn'}>
                    {items.length} issue{items.length === 1 ? '' : 's'}
                  </Badge>
                </div>
                <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{r.item_name}</span>
                        {r.item_status && <ItemStatusBadge status={r.item_status} />}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{issueActionText(r)}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const sortedRows = useMemo(() => [...rows].sort(compareTopups), [rows]);
  const activeRows = sortedRows.filter((r) => r.status === 'Open' || r.status === 'In Progress');
  const completedRows = sortedRows.filter((r) => r.status === 'Completed');
  const groups = useMemo(() => groupTopupsByBox(sortedRows), [sortedRows]);

  async function setStatus(ids: string[], status: ReportTopup['status'], remarks?: string) {
    if (ids.length === 0) {
      setActionError('Select at least one item first.');
      return;
    }
    setBusyKey(`${status}:${ids.join(',')}`);
    setActionError(null);
    try {
      const sb = getSupabaseBrowserClient();
      const { data: u } = await sb.auth.getUser();
      const done = status === 'Completed';
      const patch: Record<string, unknown> = {
        status,
        completed_by: done ? u.user?.id ?? null : null,
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
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not update.');
    } finally {
      setBusyKey(null);
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
    <section className="space-y-4">
      <ExportBar onExport={exportCsv} />
      <ReportSummary
        items={[
          { label: 'Open actions', value: activeRows.length, tone: activeRows.length > 0 ? 'warn' : 'ok' },
          {
            label: 'High priority',
            value: activeRows.filter((r) => r.priority === 'High').length,
            tone: activeRows.some((r) => r.priority === 'High') ? 'bad' : 'ok',
          },
          {
            label: 'Boxes to visit',
            value: new Set(activeRows.map((r) => r.box_id)).size,
            tone: activeRows.length > 0 ? 'warn' : 'ok',
          },
          { label: 'Completed', value: completedRows.length, tone: 'ok' },
        ]}
      />
      {actionError && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</p>
      )}
      <SectionTitle
        title="Issue stock by box"
        subtitle="Tick what you issue now. Leave unchecked items open when stock is still waiting."
      />
      <div className="space-y-3">
        {groups.map(([boxId, items]) => {
          const box = boxById.get(boxId);
          const activeInBox = items.filter((i) => i.status === 'Open' || i.status === 'In Progress');
          const selectedIds = activeInBox.filter((i) => selected[i.id]).map((i) => i.id);
          const allOpenSelected = activeInBox.length > 0 && selectedIds.length === activeInBox.length;
          const issueSelectedBusy = busyKey === `Completed:${selectedIds.join(',')}`;
          const waitingSelectedBusy = busyKey === `In Progress:${selectedIds.join(',')}`;
          const issueAllIds = activeInBox.map((i) => i.id);
          const issueAllBusy = busyKey === `Completed:${issueAllIds.join(',')}`;
          return (
            <div key={boxId} className="card overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-bold">{boxLabel(box, boxId)}</h3>
                  <p className="text-sm text-slate-600">
                    {box?.box_name ?? 'Unknown box'}{box?.area ? ` - ${box.area}` : ''}
                  </p>
                </div>
                <Badge tone={activeInBox.length > 0 ? 'warn' : 'ok'}>{activeInBox.length} open</Badge>
              </div>
              {isAdmin && activeInBox.length > 0 && (
                <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
                  <button
                    type="button"
                    className="btn btn-md btn-secondary"
                    onClick={() => toggleSelectedIds(activeInBox.map((i) => i.id), !allOpenSelected, setSelected)}
                  >
                    {allOpenSelected ? 'Clear ticks' : 'Tick all open'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-md btn-secondary"
                    disabled={selectedIds.length === 0 || Boolean(busyKey)}
                    onClick={() => setStatus(selectedIds, 'In Progress', 'Waiting stock')}
                  >
                    {waitingSelectedBusy ? <Spinner className="h-4 w-4" /> : 'Mark waiting stock'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-md bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={selectedIds.length === 0 || Boolean(busyKey)}
                    onClick={() => setStatus(selectedIds, 'Completed')}
                  >
                    {issueSelectedBusy ? <Spinner className="h-4 w-4" /> : `Issue selected (${selectedIds.length})`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-md btn-primary"
                    disabled={issueAllIds.length === 0 || Boolean(busyKey)}
                    onClick={() => setStatus(issueAllIds, 'Completed')}
                  >
                    {issueAllBusy ? <Spinner className="h-4 w-4" /> : 'Issue all open'}
                  </button>
                </div>
              )}
              <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((r) => {
                  const open = r.status === 'Open' || r.status === 'In Progress';
                  return (
                    <label
                      key={r.id}
                      className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 ${
                        open ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 text-slate-500'
                      }`}
                    >
                      {isAdmin && (
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-brand"
                          disabled={!open}
                          checked={Boolean(selected[r.id])}
                          onChange={(e) => toggleSelectedIds([r.id], e.target.checked, setSelected)}
                        />
                      )}
                      <TopupThumb url={r.item_photo_url} name={r.item_name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{r.item_name}</span>
                        <span className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                          {r.priority && <PriorityBadge priority={r.priority} />}
                          <Badge tone={topupStatusTone(r.status)}>{r.status}</Badge>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
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
  const usageStats = useMemo(() => computeUsageStats(rows), [rows]);
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
    <section className="space-y-4">
      <ExportBar onExport={exportCsv} />
      <ReportSummary
        items={[
          { label: 'Usage records', value: rows.length, tone: 'neutral' },
          { label: 'Items taken', value: usageStats.totalItems, tone: usageStats.totalItems > 0 ? 'warn' : 'ok' },
          { label: 'Boxes used', value: usageStats.boxIds.size, tone: 'neutral' },
          { label: 'Unique items', value: usageStats.topItems.length, tone: 'neutral' },
        ]}
      />
      {usageStats.topItems.length > 0 && (
        <div className="card p-4">
          <SectionTitle
            title="Most used items"
            subtitle="Use this to spot items that may need higher par levels or earlier top-up."
          />
          <div className="mt-3 space-y-3">
            {usageStats.topItems.slice(0, 6).map((item) => (
              <div key={item.name}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold capitalize">{item.name}</span>
                  <span className="text-slate-500">{item.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.max(8, (item.count / usageStats.maxItemCount) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <SectionTitle title="Recent usage" subtitle="The raw log remains available for traceability and CSV export." />
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card p-3">
            <p className="font-medium">{r.usage_purpose}</p>
            <p className="text-xs text-slate-500">
              {r.user_name} - {r.department} - {boxById.get(r.box_id)?.box_code ?? '-'} - {formatDate(r.created_at)}
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
          boxById.get(r.box_id)?.box_code ?? '-',
          r.user_name,
          r.department,
          r.usage_purpose,
          (r.items_taken ?? []).join(', '),
        ])}
      />
    </section>
  );
}

/* -------------------------------------------------------------------- Report helpers */

type ReportTone = 'ok' | 'warn' | 'bad' | 'neutral';

function ReportSummary({
  items,
}: {
  items: { label: string; value: number; tone: ReportTone }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="card p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xl font-bold tabular-nums">{item.value}</p>
            <span className={`h-2.5 w-2.5 rounded-full ${dotToneClass(item.tone)}`} />
          </div>
          <p className="mt-1 text-xs font-semibold text-slate-600">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

function MiniFact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={strong ? 'font-semibold text-slate-900' : 'text-slate-700'}>{value || '-'}</p>
    </div>
  );
}

function dotToneClass(t: ReportTone) {
  return t === 'ok' ? 'bg-emerald-500' : t === 'warn' ? 'bg-amber-500' : t === 'bad' ? 'bg-red-500' : 'bg-slate-400';
}

function boxLabel(box: BoxLite | undefined, fallback?: string | null) {
  return box?.box_code ?? fallback ?? 'Unknown box';
}

function inspectionPdfHref(inspectionId: string) {
  return `/api/reports/inspections/${encodeURIComponent(inspectionId)}/pdf`;
}

function expiryTone(status: ReportsResponse['expiry_items'][number]['expiry_status']): ReportTone {
  if (status === 'Expired' || status === 'No expiry date recorded') return 'bad';
  if (status === 'Expiring soon' || status === 'Expiry label mismatch') return 'warn';
  return 'ok';
}

function expiryAction(status: ReportsResponse['expiry_items'][number]['expiry_status']) {
  if (status === 'Expired') return 'Replace item now';
  if (status === 'Expiring soon') return 'Plan replacement';
  if (status === 'Expiry label mismatch') return 'Verify physical label';
  if (status === 'No expiry date recorded') return 'Record box-level expiry';
  return 'No action';
}

function observedText(r: ReportsResponse['inspection_items'][number]) {
  if (r.observed_quantity !== null && r.observed_quantity !== undefined) {
    return `${r.observed_quantity}${r.unit ? ` ${r.unit}` : ''}`;
  }
  return r.observed_volume_level ?? r.observed_present_status ?? '-';
}

function issueActionText(r: ReportsResponse['inspection_items'][number]) {
  if (r.item_status === 'Expired') return 'Replace item and record the new expiry date.';
  if (r.item_status === 'Low Stock') return 'Top up to the required level.';
  if (r.item_status === 'Missing') return 'Item is missing from the box.';
  if (r.item_status === 'Damaged') return 'Replace damaged item.';
  if (r.item_status === 'Expiring Soon') return 'Plan replacement before expiry.';
  if (r.item_status === 'No Expiry Date') return 'Record the box-level expiry date.';
  if (r.item_status === 'Expiry Label Mismatch') return 'Verify and correct the expiry record.';
  if (r.topup_required) return 'Top-up action required.';
  return 'Review this inspection issue.';
}

function topupStatusTone(status: ReportTopup['status']): ReportTone {
  if (status === 'Completed') return 'ok';
  if (status === 'Rejected') return 'neutral';
  if (status === 'Open') return 'warn';
  return 'neutral';
}

function TopupThumb({ url, name }: { url: string | null; name: string }) {
  if (!url) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-[10px] font-semibold text-slate-400">
        {initials(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white object-cover"
    />
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const priorityOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const statusOrder: Record<ReportTopup['status'], number> = {
  Open: 0,
  'In Progress': 1,
  Completed: 2,
  Rejected: 3,
};

function compareTopups(a: ReportTopup, b: ReportTopup) {
  const statusDiff = statusOrder[a.status] - statusOrder[b.status];
  if (statusDiff !== 0) return statusDiff;
  const priorityDiff = (priorityOrder[a.priority ?? 'Low'] ?? 3) - (priorityOrder[b.priority ?? 'Low'] ?? 3);
  if (priorityDiff !== 0) return priorityDiff;
  return new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime();
}

function groupTopupsByBox(rows: ReportTopup[]) {
  const groups = new Map<string, ReportTopup[]>();
  for (const row of rows) {
    const list = groups.get(row.box_id) ?? [];
    list.push(row);
    groups.set(row.box_id, list);
  }
  return [...groups.entries()];
}

function groupExpiryByBox(rows: ReportsResponse['expiry_items']) {
  const groups = new Map<string, ReportsResponse['expiry_items']>();
  for (const row of rows) {
    const list = groups.get(row.box_id) ?? [];
    list.push(row);
    groups.set(row.box_id, list);
  }
  return [...groups.entries()];
}

function groupInspectionIssuesByBox(rows: ReportsResponse['inspection_items']) {
  const groups = new Map<string, ReportsResponse['inspection_items']>();
  for (const row of rows) {
    const key = row.box_id ?? row.inspection_id;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()];
}

function toggleSelectedIds(
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

function computeUsageStats(rows: ReportsResponse['usage_logs']) {
  const itemCounts = new Map<string, number>();
  const boxIds = new Set<string>();
  let totalItems = 0;
  for (const row of rows) {
    boxIds.add(row.box_id);
    for (const raw of row.items_taken ?? []) {
      const name = raw.trim().toLowerCase();
      if (!name) continue;
      totalItems++;
      itemCounts.set(name, (itemCounts.get(name) ?? 0) + 1);
    }
  }
  const topItems = [...itemCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    boxIds,
    totalItems,
    topItems,
    maxItemCount: Math.max(1, topItems[0]?.count ?? 1),
  };
}

/* -------------------------------------------------------------------- Bits */

function Field({ label, children }: { label: string; children: ReactNode }) {
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

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
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
