'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client/api.ts';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Me, ReportsResponse } from '@/lib/client/types.ts';
import { downloadCsv, toCsv } from '@/lib/client/csv.ts';
import { formatDate, formatDateTime, todayIso } from '@/lib/client/format.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { EshNav } from '@/components/esh/EshNav';
import { Spinner } from '@/components/Spinner';
import { ActionStatusBadge, Badge, PriorityBadge, ReadinessBadge } from '@/components/StatusBadge';

interface BoxLite {
  id: string;
  box_code: string;
  area: string | null;
}
type Tab = 'inspections' | 'actions' | 'usage';

export default function ReportsPage() {
  return <RequireAuth roles={['superadmin', 'admin']}>{(me) => <Dashboard me={me} />}</RequireAuth>;
}

function Dashboard({ me }: { me: Me }) {
  const [boxes, setBoxes] = useState<BoxLite[]>([]);
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inspections');
  const reportsRef = useRef<HTMLDivElement | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [boxId, setBoxId] = useState('');

  const boxCode = useMemo(() => new Map(boxes.map((b) => [b.id, b.box_code])), [boxes]);

  async function load() {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (boxId) p.set('box_id', boxId);
    try {
      setData(await api.reports(p.toString()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getSupabaseBrowserClient()
      .from('boxes')
      .select('id, box_code, area')
      .order('box_code')
      .then(({ data }) => setBoxes((data ?? []) as unknown as BoxLite[]));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openReportTab(nextTab: Tab) {
    setTab(nextTab);
    window.setTimeout(() => reportsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  return (
    <>
      <AppHeader title="First Aid Readiness" subtitle={me.full_name} right={<EshNav role={me.role} />} />
      <main className="mx-auto max-w-6xl space-y-5 p-4">
        <div>
          <h1 className="text-xl font-bold">First Aid Readiness Dashboard</h1>
          <p className="text-sm text-slate-500">What needs attention today.</p>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        {loading && (
          <div className="flex justify-center py-12 text-slate-400">
            <Spinner className="h-7 w-7" />
          </div>
        )}

        {data && !loading && (
          <>
            <Cards d={data.dashboard} canOpenAdmin={me.role === 'superadmin' || me.role === 'admin'} onOpenTab={openReportTab} />

            {false && data && (
              <div className="hidden">
              <section className="card p-4 lg:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-bold">Needs Attention Today</h2>
                  <a href="/actions" className="text-sm font-semibold text-brand">
                    View all
                  </a>
                </div>
                {data!.needs_attention.length === 0 ? (
                  <p className="py-6 text-center text-slate-500">Nothing needs attention. 🎉</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data!.needs_attention.map((n) => (
                      <li key={n.id}>
                        <a href={`/actions/${n.id}`} className="flex items-center justify-between gap-2 py-3 hover:bg-slate-50">
                          <div className="min-w-0">
                            <p className="font-semibold">{n.box_code}</p>
                            <p className="truncate text-xs text-slate-500">{n.location}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm">{n.issue_type}{n.item_name ? ` · ${n.item_name}` : ''}</p>
                            {n.priority && <PriorityBadge priority={n.priority} />}
                          </div>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card flex flex-col items-center p-4">
                <h2 className="mb-2 self-start font-bold">Inspection Compliance</h2>
                <Donut percent={data!.compliance.percent} />
                <div className="mt-2 space-y-1 text-sm">
                  <p>
                    <span className="badge status-ok">COMPLETED</span> {data!.compliance.completed} boxes
                  </p>
                  <p>
                    <span className="badge status-warn">ATTENTION</span> {data!.compliance.attention} boxes
                  </p>
                </div>
                <h3 className="mt-4 self-start text-sm font-semibold text-slate-600">Inspection trend</h3>
                <Trend points={data!.trend} />
              </section>
              </div>
            )}

            <DashboardCharts data={data} />
            <NeedsAttentionToday items={data.needs_attention} />

            {/* Filters + report tabs */}
            <section className="card p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                      <option key={b.id} value={b.id}>{b.box_code}</option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end">
                  <button onClick={load} className="btn btn-md btn-primary w-full">Apply</button>
                </div>
              </div>
            </section>

            <div ref={reportsRef} className="flex flex-wrap gap-2 scroll-mt-4">
              {(['inspections', 'actions', 'usage'] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`btn btn-md ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {tab === 'inspections' && <InspectionsReport data={data} boxCode={boxCode} />}
            {tab === 'actions' && <ActionsReport data={data} boxCode={boxCode} />}
            {tab === 'usage' && <UsageReport data={data} boxCode={boxCode} />}
          </>
        )}
      </main>
    </>
  );
}

type CardTarget = { kind: 'href'; href: string } | { kind: 'tab'; tab: Tab };

function Cards({
  d,
  canOpenAdmin,
  onOpenTab,
}: {
  d: ReportsResponse['dashboard'];
  canOpenAdmin: boolean;
  onOpenTab: (tab: Tab) => void;
}) {
  const inventoryTarget: CardTarget = canOpenAdmin
    ? { kind: 'href', href: '/admin?tab=expiring-items' }
    : { kind: 'tab', tab: 'actions' };
  const cards: Array<{
    label: string;
    value: number;
    tone: 'ok' | 'warn' | 'bad' | 'neutral';
    target: CardTarget;
  }> = [
    { label: 'Due This Month', value: d.due_this_month, tone: 'neutral', target: { kind: 'href', href: '/my-boxes?filter=due-this-month' } },
    { label: 'Overdue', value: d.overdue, tone: d.overdue > 0 ? 'bad' : 'ok', target: { kind: 'href', href: '/my-boxes?filter=overdue' } },
    { label: 'Seal Broken / Used', value: d.seal_broken_used, tone: d.seal_broken_used > 0 ? 'warn' : 'ok', target: { kind: 'tab', tab: 'inspections' } },
    { label: 'Expired Items', value: d.expired_items, tone: d.expired_items > 0 ? 'bad' : 'ok', target: inventoryTarget },
    { label: 'Expiring in 30 Days', value: d.expiring_30_days, tone: d.expiring_30_days > 0 ? 'warn' : 'ok', target: inventoryTarget },
    { label: 'Open Actions', value: d.open_actions, tone: d.open_actions > 0 ? 'warn' : 'ok', target: { kind: 'href', href: '/actions' } },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(({ label, value, tone, target }) => {
        const content = (
          <>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs leading-tight text-slate-500">{label}</p>
          <span
            className={`mt-1 block h-1 w-8 rounded-full ${
              tone === 'ok' ? 'bg-emerald-400' : tone === 'warn' ? 'bg-amber-400' : tone === 'bad' ? 'bg-red-400' : 'bg-slate-300'
            }`}
          />
          </>
        );
        const cls = 'card block w-full p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand/30';
        return target.kind === 'href' ? (
          <a key={label} href={target.href} className={cls}>
            {content}
          </a>
        ) : (
          <button key={label} type="button" onClick={() => onOpenTab(target.tab)} className={cls}>
            {content}
          </button>
        );
      })}
    </section>
  );
}

function DashboardCharts({ data }: { data: ReportsResponse }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <ComplianceChart data={data} />
      <ItemActivityChart data={data} />
      <div className="lg:col-span-2">
        <MonthlyActionComboChart points={data.action_monthly} />
      </div>
    </section>
  );
}

function ComplianceChart({ data }: { data: ReportsResponse }) {
  return (
    <section className="card flex flex-col items-center p-4">
      <h2 className="mb-2 self-start font-bold">Inspection Compliance</h2>
      <Donut percent={data.compliance.percent} />
      <div className="mt-2 space-y-1 text-sm">
        <p>
          <span className="badge status-ok">COMPLETED</span> {data.compliance.completed} boxes
        </p>
        <p>
          <span className="badge status-warn">ATTENTION</span> {data.compliance.attention} boxes
        </p>
      </div>
      <h3 className="mt-4 self-start text-sm font-semibold text-slate-600">Inspection trend</h3>
      <Trend points={data.trend} />
    </section>
  );
}

function NeedsAttentionToday({ items }: { items: ReportsResponse['needs_attention'] }) {
  const pageSize = 5;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const visible = items.slice(start, start + pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-bold">Needs Attention Today</h2>
        <a href="/actions" className="text-sm font-semibold text-brand">
          View all
        </a>
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-slate-500">Nothing needs attention.</p>
      ) : (
        <>
          {totalPages > 1 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                Showing {start + 1}-{Math.min(start + pageSize, items.length)} of {items.length}
              </p>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-current={p === currentPage ? 'page' : undefined}
                    onClick={() => setPage(p)}
                    className={`h-8 min-w-8 rounded-lg border px-2 text-sm font-semibold ${
                      p === currentPage
                        ? 'border-brand bg-brand text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-brand/40'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 md:hidden">
            {visible.map((n) => (
              <a key={n.id} href={`/actions/${n.id}`} className="block rounded-lg border border-slate-100 p-3 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{n.box_code}</p>
                    <p className="truncate text-xs text-slate-500">{n.location}</p>
                    <p className="mt-1 text-sm">{attentionIssue(n)}</p>
                  </div>
                  {n.priority && <PriorityBadge priority={n.priority} />}
                </div>
              </a>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">Box</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Action item</th>
                  <th className="px-3 py-2 text-right font-medium">Priority</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((n) => (
                  <tr key={n.id} className="border-b border-slate-100">
                    <td className="px-3 py-3 align-top">
                      <a href={`/actions/${n.id}`} className="font-semibold text-brand">{n.box_code}</a>
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-slate-500">{n.location}</td>
                    <td className="px-3 py-3 align-top">{attentionIssue(n)}</td>
                    <td className="px-3 py-3 text-right align-top">{n.priority && <PriorityBadge priority={n.priority} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function attentionIssue(item: ReportsResponse['needs_attention'][number]) {
  return item.item_name ? `${item.issue_type} - ${item.item_name}` : item.issue_type;
}

interface ActivityRow {
  item: string;
  used: number;
  replenished: number;
}

function ItemActivityChart({ data }: { data: ReportsResponse }) {
  const rows = useMemo(() => buildItemActivity(data), [data]);
  const [hover, setHover] = useState<{ id: string; item: string; label: string; value: number } | null>(null);

  if (rows.length === 0) {
    return (
      <section className="card p-4">
        <h2 className="font-bold">Usage and Replenishment Activity</h2>
        <p className="mt-8 text-center text-sm text-slate-500">No usage or replenishment activity in this view.</p>
      </section>
    );
  }

  const width = 640;
  const left = 170;
  const right = 32;
  const chartWidth = width - left - right;
  const rowHeight = 42;
  const top = 44;
  const height = top + rows.length * rowHeight + 18;
  const max = Math.max(1, ...rows.flatMap((row) => [row.used, row.replenished]));

  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">Usage and Replenishment Activity</h2>
          <p className="min-h-5 text-sm font-semibold text-slate-600">
            {hover ? `${hover.item}: ${hover.label} ${hover.value}` : ' '}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Used</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Replenished</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Usage and replenishment bar chart">
        <line x1={left} y1={top - 10} x2={left} y2={height - 12} stroke="#e2e8f0" />
        {rows.map((row, index) => {
          const y = top + index * rowHeight;
          const usedWidth = (row.used / max) * chartWidth;
          const replenishedWidth = (row.replenished / max) * chartWidth;
          const usedId = `${row.item}-used`;
          const replenishedId = `${row.item}-replenished`;
          return (
            <g key={row.item}>
              <text x={0} y={y + 13} className="fill-slate-600 text-[11px] font-semibold">
                {shortLabel(row.item, 25)}
              </text>
              <rect
                x={left}
                y={y}
                width={usedWidth}
                height={10}
                rx={3}
                fill="#16a34a"
                tabIndex={0}
                className="cursor-pointer"
                onMouseEnter={() => setHover({ id: usedId, item: row.item, label: 'Used', value: row.used })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ id: usedId, item: row.item, label: 'Used', value: row.used })}
                onBlur={() => setHover(null)}
              >
                <title>{`${row.item}: Used ${row.used}`}</title>
              </rect>
              <rect
                x={left}
                y={y + 15}
                width={replenishedWidth}
                height={10}
                rx={3}
                fill="#f59e0b"
                tabIndex={0}
                className="cursor-pointer"
                onMouseEnter={() => setHover({ id: replenishedId, item: row.item, label: 'Replenished', value: row.replenished })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ id: replenishedId, item: row.item, label: 'Replenished', value: row.replenished })}
                onBlur={() => setHover(null)}
              >
                <title>{`${row.item}: Replenished ${row.replenished}`}</title>
              </rect>
              {hover?.id === usedId && (
                <text x={left + usedWidth + 6} y={y + 9} className="fill-slate-700 text-[11px] font-bold">{row.used}</text>
              )}
              {hover?.id === replenishedId && (
                <text x={left + replenishedWidth + 6} y={y + 24} className="fill-slate-700 text-[11px] font-bold">{row.replenished}</text>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function buildItemActivity(data: ReportsResponse): ActivityRow[] {
  const byItem = new Map<string, ActivityRow>();
  const ensure = (item: string) => {
    const key = item.trim();
    const existing = byItem.get(key);
    if (existing) return existing;
    const next = { item: key, used: 0, replenished: 0 };
    byItem.set(key, next);
    return next;
  };

  for (const log of data.usage_logs) {
    for (const item of log.items_taken ?? []) {
      const name = item.trim();
      if (name) ensure(name).used++;
    }
  }

  for (const action of data.actions) {
    if (action.status !== 'Closed' || !action.item_name) continue;
    ensure(action.item_name).replenished++;
  }

  return [...byItem.values()]
    .filter((row) => row.used > 0 || row.replenished > 0)
    .sort((a, b) => b.used + b.replenished - (a.used + a.replenished) || a.item.localeCompare(b.item))
    .slice(0, 7);
}

function shortLabel(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function MonthlyActionComboChart({ points }: { points: ReportsResponse['action_monthly'] }) {
  const [hover, setHover] = useState<{ id: string; label: string; series: string; value: number } | null>(null);
  const width = 720;
  const height = 300;
  const margin = { top: 48, right: 56, bottom: 44, left: 52 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const leftMax = Math.max(1, ...points.flatMap((point) => [point.created, point.closed]));
  const rightMax = Math.max(1, ...points.map((point) => point.backlog));
  const groupWidth = chartWidth / Math.max(1, points.length);
  const barWidth = Math.min(24, groupWidth * 0.18);
  const xCenter = (index: number) => margin.left + groupWidth * index + groupWidth / 2;
  const yLeft = (value: number) => margin.top + chartHeight - (value / leftMax) * chartHeight;
  const yRight = (value: number) => margin.top + chartHeight - (value / rightMax) * chartHeight;
  const linePoints = points.map((point, index) => `${xCenter(index)},${yRight(point.backlog)}`).join(' ');

  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">Monthly Action Items</h2>
          <p className="min-h-5 text-sm font-semibold text-slate-600">
            {hover ? `${hover.label}: ${hover.series} ${hover.value}` : ' '}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Created</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />Closed</span>
          <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 bg-red-500" />Backlog</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full" role="img" aria-label="Monthly action item combination chart">
        {[0, 0.5, 1].map((tick) => {
          const y = margin.top + chartHeight - tick * chartHeight;
          return (
            <g key={tick}>
              <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="#e2e8f0" strokeDasharray={tick === 0 ? undefined : '4 4'} />
              <text x={margin.left - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
                {Math.round(leftMax * tick)}
              </text>
              <text x={width - margin.right + 8} y={y + 4} className="fill-slate-400 text-[10px]">
                {Math.round(rightMax * tick)}
              </text>
            </g>
          );
        })}
        <text x={margin.left} y={20} className="fill-slate-500 text-[10px] font-semibold">Created / Closed</text>
        <text x={width - margin.right} y={20} textAnchor="end" className="fill-slate-500 text-[10px] font-semibold">Backlog</text>

        {points.map((point, index) => {
          const center = xCenter(index);
          const createdId = `${point.label}-created`;
          const closedId = `${point.label}-closed`;
          const createdY = yLeft(point.created);
          const closedY = yLeft(point.closed);
          return (
            <g key={point.label}>
              <rect
                x={center - barWidth - 3}
                y={createdY}
                width={barWidth}
                height={margin.top + chartHeight - createdY}
                rx={3}
                fill="#16a34a"
                tabIndex={0}
                className="cursor-pointer"
                onMouseEnter={() => setHover({ id: createdId, label: point.label, series: 'Created', value: point.created })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ id: createdId, label: point.label, series: 'Created', value: point.created })}
                onBlur={() => setHover(null)}
              >
                <title>{`${point.label}: Created ${point.created}`}</title>
              </rect>
              <rect
                x={center + 3}
                y={closedY}
                width={barWidth}
                height={margin.top + chartHeight - closedY}
                rx={3}
                fill="#2563eb"
                tabIndex={0}
                className="cursor-pointer"
                onMouseEnter={() => setHover({ id: closedId, label: point.label, series: 'Closed', value: point.closed })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ id: closedId, label: point.label, series: 'Closed', value: point.closed })}
                onBlur={() => setHover(null)}
              >
                <title>{`${point.label}: Closed ${point.closed}`}</title>
              </rect>
              {hover?.id === createdId && (
                <text x={center - barWidth / 2 - 3} y={Math.max(34, createdY - 6)} textAnchor="middle" className="fill-slate-700 text-[11px] font-bold">
                  {point.created}
                </text>
              )}
              {hover?.id === closedId && (
                <text x={center + barWidth / 2 + 3} y={Math.max(34, closedY - 6)} textAnchor="middle" className="fill-slate-700 text-[11px] font-bold">
                  {point.closed}
                </text>
              )}
              <text x={center} y={height - 16} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {point.label}
              </text>
            </g>
          );
        })}

        <polyline fill="none" stroke="#ef4444" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" points={linePoints} />
        {points.map((point, index) => {
          const id = `${point.label}-backlog`;
          return (
            <circle
              key={id}
              cx={xCenter(index)}
              cy={yRight(point.backlog)}
              r={4}
              fill="#ef4444"
              stroke="#fff"
              strokeWidth={2}
              tabIndex={0}
              className="cursor-pointer"
              onMouseEnter={() => setHover({ id, label: point.label, series: 'Backlog', value: point.backlog })}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover({ id, label: point.label, series: 'Backlog', value: point.backlog })}
              onBlur={() => setHover(null)}
            >
              <title>{`${point.label}: Backlog ${point.backlog}`}</title>
            </circle>
          );
        })}
      </svg>
    </section>
  );
}

function Donut({ percent }: { percent: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - percent / 100);
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="#16a34a"
        strokeWidth="14"
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="58" textAnchor="middle" className="fill-slate-900 text-lg font-bold">
        {percent}%
      </text>
      <text x="60" y="76" textAnchor="middle" className="fill-slate-500 text-[10px]">
        Compliant
      </text>
    </svg>
  );
}

function Trend({ points }: { points: { label: string; count: number }[] }) {
  const w = 240;
  const h = 56;
  const max = Math.max(1, ...points.map((p) => p.count));
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const coords = points.map((p, i) => [i * step, h - (p.count / max) * (h - 6) - 3]);
  const line = coords.map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        <polyline fill="none" stroke="#16a34a" strokeWidth="2.5" points={line} />
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400">
        {points.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

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

function ExportBar({ onExport }: { onExport: () => void }) {
  return (
    <div className="mb-2 flex justify-end">
      <button onClick={onExport} className="btn btn-md btn-secondary">⬇ Export CSV</button>
    </div>
  );
}

function InspectionsReport({ data, boxCode }: { data: ReportsResponse; boxCode: Map<string, string> }) {
  const rows = data.inspections;
  if (rows.length === 0) return <Empty label="No inspections in range." />;
  return (
    <section>
      <ExportBar
        onExport={() =>
          downloadCsv(
            `inspections-${todayIso()}.csv`,
            toCsv(rows, [
              { key: 'created_at', label: 'Date', value: (r) => formatDateTime(r.created_at) },
              { key: 'box', label: 'Box', value: (r) => r.boxes?.box_code ?? boxCode.get(r.box_id) ?? '' },
              { key: 'inspector_name', label: 'Inspector' },
              { key: 'overall_status', label: 'Status' },
              { key: 'seal_intact', label: 'Seal intact', value: (r) => (r.seal_intact === false ? 'No' : 'Yes') },
              { key: 'item_check_performed', label: 'Item check', value: (r) => (r.item_check_performed ? 'Yes' : 'No') },
              { key: 'notes', label: 'Notes' },
            ]),
          )
        }
      />
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card flex items-center justify-between p-3">
            <div>
              <p className="font-semibold">{r.boxes?.box_code ?? '—'}</p>
              <p className="text-xs text-slate-500">{formatDateTime(r.created_at)} · {r.inspector_name}</p>
            </div>
            <ReadinessBadge status={r.overall_status} />
          </div>
        ))}
      </div>
      <Table
        head={['Date', 'Box', 'Inspector', 'Seal', 'Status']}
        rows={rows.map((r) => [
          formatDateTime(r.created_at),
          r.boxes?.box_code ?? '—',
          r.inspector_name,
          r.seal_intact === false ? 'Broken' : 'Intact',
          <ReadinessBadge key="s" status={r.overall_status} />,
        ])}
      />
    </section>
  );
}

function ActionsReport({ data, boxCode }: { data: ReportsResponse; boxCode: Map<string, string> }) {
  const rows = data.actions;
  if (rows.length === 0) return <Empty label="No actions in range." />;
  return (
    <section>
      <ExportBar
        onExport={() =>
          downloadCsv(
            `actions-${todayIso()}.csv`,
            toCsv(rows, [
              { key: 'action_code', label: 'Code' },
              { key: 'created_at', label: 'Created', value: (r) => formatDateTime(r.created_at) },
              { key: 'box', label: 'Box', value: (r) => r.boxes?.box_code ?? boxCode.get(r.box_id) ?? '' },
              { key: 'action_type', label: 'Type' },
              { key: 'item_name', label: 'Item' },
              { key: 'priority', label: 'Priority' },
              { key: 'status', label: 'Status' },
              { key: 'closure_note', label: 'Closure note' },
              { key: 'closed_at', label: 'Closed', value: (r) => formatDateTime(r.closed_at) },
            ]),
          )
        }
      />
      <Table
        head={['Code', 'Box', 'Type', 'Item', 'Priority', 'Status']}
        rows={rows.map((r) => [
          <a key="c" href={`/actions/${r.id}`} className="font-semibold text-brand">{r.action_code}</a>,
          r.boxes?.box_code ?? boxCode.get(r.box_id) ?? '—',
          r.action_type,
          r.item_name ?? '—',
          r.priority ? <PriorityBadge key="p" priority={r.priority} /> : '—',
          <ActionStatusBadge key="s" status={r.status} />,
        ])}
      />
    </section>
  );
}

function UsageReport({ data, boxCode }: { data: ReportsResponse; boxCode: Map<string, string> }) {
  const rows = data.usage_logs;
  if (rows.length === 0) return <Empty label="No usage logs in range." />;
  return (
    <section>
      <ExportBar
        onExport={() =>
          downloadCsv(
            `usage-${todayIso()}.csv`,
            toCsv(rows, [
              { key: 'created_at', label: 'Date', value: (r) => formatDateTime(r.created_at) },
              { key: 'box', label: 'Box', value: (r) => boxCode.get(r.box_id) ?? r.box_id },
              { key: 'user_name', label: 'Name' },
              { key: 'department', label: 'Department' },
              { key: 'usage_purpose', label: 'Purpose' },
              { key: 'items_taken', label: 'Items', value: (r) => (r.items_taken ?? []).join('; ') },
            ]),
          )
        }
      />
      <Table
        head={['Date', 'Box', 'Name', 'Department', 'Purpose']}
        rows={rows.map((r) => [
          formatDate(r.created_at),
          boxCode.get(r.box_id) ?? '—',
          r.user_name,
          r.department,
          r.usage_purpose,
        ])}
      />
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
