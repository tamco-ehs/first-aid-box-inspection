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
  return <RequireAuth roles={['admin', 'viewer']}>{(me) => <Dashboard me={me} />}</RequireAuth>;
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
            <Cards d={data.dashboard} canOpenAdmin={me.role === 'admin'} onOpenTab={openReportTab} />

            <div className="grid gap-4 lg:grid-cols-3">
              <section className="card p-4 lg:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-bold">Needs Attention Today</h2>
                  <a href="/actions" className="text-sm font-semibold text-brand">
                    View all
                  </a>
                </div>
                {data.needs_attention.length === 0 ? (
                  <p className="py-6 text-center text-slate-500">Nothing needs attention. 🎉</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.needs_attention.map((n) => (
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
            </div>

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
