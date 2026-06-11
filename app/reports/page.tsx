'use client';

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { api } from '@/lib/client/api.ts';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Me, ReportsResponse, ReportTopup } from '@/lib/client/types.ts';
import { downloadCsv, toCsv } from '@/lib/client/csv.ts';
import { formatDate, formatDateTime, todayIso } from '@/lib/client/format.ts';
import { computeDue } from '@/lib/logic/due.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { Spinner } from '@/components/Spinner';
import { Badge, DueBadge, ItemStatusBadge, OverallBadge, PriorityBadge } from '@/components/StatusBadge';

interface BoxLite {
  id: string;
  box_code: string;
  box_name: string;
  location_description: string | null;
  area: string | null;
  created_at: string;
  inspection_frequency_days: number;
}

type Tab = 'action' | 'boxes' | 'reports';
type ActionFilter = 'all' | 'not_ready' | 'topup' | 'expiry' | 'overdue';

// Keep old email/KPI links working while making the dashboard action-first.
function mapTab(t: string): Tab {
  if (t === 'boxes') return 'boxes';
  if (t === 'reports' || t === 'inspections' || t === 'issues' || t === 'usage') return 'reports';
  return 'action';
}

function mapActionFilter(raw: string): ActionFilter {
  if (raw === 'not_ready' || raw === 'critical' || raw === 'expired' || raw === 'missing') return 'not_ready';
  if (raw === 'topup' || raw === 'topup_required' || raw === 'low_stock') return 'topup';
  if (raw === 'expiry' || raw === 'expiring_30d' || raw === 'expiring_soon' || raw === 'verification') return 'expiry';
  if (raw === 'overdue' || raw === 'overdue_inspection') return 'overdue';
  return 'all';
}

export default function ReportsPage() {
  return <RequireAuth roles={['admin', 'viewer']}>{(me) => <Reports me={me} />}</RequireAuth>;
}

function Reports({ me }: { me: Me }) {
  const [boxes, setBoxes] = useState<BoxLite[]>([]);
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('action');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
      .select('id, box_code, box_name, location_description, area, created_at, inspection_frequency_days')
      .eq('is_active', true)
      .order('box_code')
      .then(({ data }) => setBoxes((data ?? []) as unknown as BoxLite[]));
    // Deep-link support: /admin/dashboard?tab=action&boxId=...&filter=topup_required
    // plus the older /reports?tab=actions&box_id=...&issue_type=expired format.
    const sp = new URLSearchParams(window.location.search);
    const urlBox = sp.get('box_id') || sp.get('boxId') || sp.get('box') || '';
    const urlIssue = sp.get('issue_type') || '';
    const urlFilter = sp.get('filter') || urlIssue || '';
    const urlTab = sp.get('tab') || '';
    if (urlBox) setBoxId(urlBox);
    if (urlIssue) setIssueType(urlIssue);
    if (urlFilter) setActionFilter(mapActionFilter(urlFilter));
    if (urlTab) setTab(mapTab(urlTab));
    load({ box_id: urlBox || undefined, issue_type: urlIssue || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setRouteState(nextTab: Tab, nextFilter?: ActionFilter) {
    setTab(nextTab);
    if (nextFilter) setActionFilter(nextFilter);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', nextTab);
    if (nextFilter && nextFilter !== 'all') params.set('filter', nextFilter);
    else params.delete('filter');
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', next);
  }

  function onJump(nextFilter: ActionFilter) {
    setRouteState('action', nextFilter);
  }

  const insights = useMemo(() => computeInsights(data), [data]);
  const filterPanel = (
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
      <div className="mt-3 flex flex-wrap gap-2">
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
            load({ from: '', to: '', box_id: '', area: '', status: '', issue_type: '' });
          }}
          className="btn btn-md btn-secondary"
        >
          Reset
        </button>
      </div>
    </section>
  );

  return (
    <>
      <AppHeader
        title="Action Dashboard"
        subtitle={me.full_name}
        right={
          <a href={me.role === 'admin' ? '/admin' : '/my-boxes'} className="btn btn-ghost btn-md text-slate-600">
            Home
          </a>
        }
      />
      <main className="mx-auto max-w-5xl space-y-5 p-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['action', 'Action'],
              ['boxes', 'Boxes'],
              ['reports', 'Reports'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRouteState(key)}
              className={`btn btn-md ${tab === key ? 'btn-primary' : 'btn-secondary'}`}
              data-tour={key === 'action' ? 'reports-action-tab' : key === 'reports' ? 'reports-tab' : undefined}
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
            {tab === 'action' && (
              <ActionTab
                data={data}
                boxes={boxes}
                boxById={boxById}
                filter={actionFilter}
                onFilter={onJump}
                advancedOpen={advancedOpen}
                setAdvancedOpen={setAdvancedOpen}
                advancedFilters={filterPanel}
                isAdmin={me.role === 'admin'}
                onChanged={load}
              />
            )}
            {tab === 'boxes' && <BoxesReadiness data={data} boxes={boxes} boxById={boxById} onJump={onJump} />}
            {tab === 'reports' && (
              <ReportsArchive data={data} issueType={issueType} boxById={boxById} filters={filterPanel} insights={insights} />
            )}
          </>
        )}
      </main>
    </>
  );
}

/* ------------------------------------------------------------- Action view */

type ReportTone = 'ok' | 'warn' | 'bad' | 'neutral';
type ActionCategory = 'not_ready' | 'topup' | 'expiry' | 'overdue';

interface DashboardAction {
  id: string;
  category: ActionCategory;
  priority: 'High' | 'Medium' | 'Low';
  boxId: string;
  boxCode: string;
  boxName: string;
  area: string;
  itemName: string;
  itemPhotoUrl: string | null;
  issue: string;
  requiredAction: string;
  observed: string;
  required: string;
  expiryDate: string | null;
  status: string;
  sortRank: number;
  requestedAt: string;
  topupId?: string;
  href: string;
}

interface DashboardActionGroup {
  boxId: string;
  boxCode: string;
  boxName: string;
  area: string;
  actions: DashboardAction[];
  sortRank: number;
}

function ActionTab({
  data,
  boxes,
  boxById,
  filter,
  onFilter,
  advancedOpen,
  setAdvancedOpen,
  advancedFilters,
  isAdmin,
  onChanged,
}: {
  data: ReportsResponse;
  boxes: BoxLite[];
  boxById: Map<string, BoxLite>;
  filter: ActionFilter;
  onFilter: (filter: ActionFilter) => void;
  advancedOpen: boolean;
  setAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  advancedFilters: ReactNode;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actions = useMemo(() => buildActionQueue(data, boxes, boxById), [data, boxes, boxById]);
  const counts = useMemo(() => actionCounts(actions), [actions]);
  const visible = useMemo(() => actions.filter((a) => filter === 'all' || a.category === filter), [actions, filter]);
  const groups = useMemo(() => groupDashboardActionsByBox(visible, boxById), [visible, boxById]);

  async function setTopupStatus(actionsToUpdate: DashboardAction[], status: ReportTopup['status'], remarks?: string) {
    const topupIds = actionsToUpdate.map((a) => a.topupId).filter((id): id is string => Boolean(id));
    if (topupIds.length === 0) {
      setActionError('Select at least one top-up item first.');
      return;
    }
    setBusyKey(bulkActionKey(status, actionsToUpdate));
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
      const { error } = await sb
        .from('topup_requests')
        .update(patch)
        .in('id', topupIds);
      if (error) throw new Error(error.message);
      setSelected((prev) => {
        const next = { ...prev };
        for (const action of actionsToUpdate) delete next[action.id];
        return next;
      });
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not update action items.');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="space-y-4" data-tour="dashboard-decision">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <ReadinessCard label="Not Ready" count={counts.notReady} tone={counts.notReady > 0 ? 'bad' : 'ok'} onClick={() => onFilter('not_ready')} active={filter === 'not_ready'} />
        <ReadinessCard label="Top-up Required" count={counts.topup} tone={counts.topup > 0 ? 'warn' : 'ok'} onClick={() => onFilter('topup')} active={filter === 'topup'} />
        <ReadinessCard label="Expiring <=30d" count={counts.expiry} tone={counts.expiry > 0 ? 'warn' : 'ok'} onClick={() => onFilter('expiry')} active={filter === 'expiry'} />
        <ReadinessCard label="Overdue Inspection" count={counts.overdue} tone={counts.overdue > 0 ? 'bad' : 'ok'} onClick={() => onFilter('overdue')} active={filter === 'overdue'} />
      </div>

      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', 'All'],
              ['not_ready', 'Not Ready'],
              ['topup', 'Top-up'],
              ['expiry', 'Expiry'],
              ['overdue', 'Overdue'],
            ] as [ActionFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onFilter(key)}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                filter === key ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Filter
          </button>
        </div>
        {advancedOpen && <div className="mt-3">{advancedFilters}</div>}
      </div>

      {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</p>}

      <div className="flex items-end justify-between gap-3">
        <SectionTitle
          title="Today's Action Queue"
          subtitle="Grouped by box so stock can be prepared and issued in one trip."
        />
        <span className="text-sm font-semibold text-slate-500">
          {groups.length} box{groups.length === 1 ? '' : 'es'} / {visible.length} item{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      {visible.length === 0 ? (
        <Empty label="No actions in this filter." />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <DashboardActionBoxGroup
              key={group.boxId}
              group={group}
              isAdmin={isAdmin}
              selected={selected}
              busyKey={busyKey}
              onToggle={(ids, checked) => toggleSelectedIds(ids, checked, setSelected)}
              onSetStatus={setTopupStatus}
            />
          ))}
        </div>
      )}

      <MasterDataCleanup dashboard={data.dashboard} />
    </section>
  );
}

function ReadinessCard({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: ReportTone;
  active: boolean;
  onClick: () => void;
}) {
  const badge = tone === 'bad' ? 'Act now' : tone === 'warn' ? 'Plan' : 'Clear';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card p-3 text-left transition hover:-translate-y-0.5 hover:shadow ${
        active ? 'border-brand ring-2 ring-brand/20' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-bold tabular-nums">{count}</p>
          <p className="text-xs font-semibold text-slate-700">{label}</p>
        </div>
        <span className={`badge ${toneToClass(tone)}`}>{badge}</span>
      </div>
    </button>
  );
}

function DashboardActionBoxGroup({
  group,
  isAdmin,
  selected,
  busyKey,
  onToggle,
  onSetStatus,
}: {
  group: DashboardActionGroup;
  isAdmin: boolean;
  selected: Record<string, boolean>;
  busyKey: string | null;
  onToggle: (ids: string[], checked: boolean) => void;
  onSetStatus: (actions: DashboardAction[], status: ReportTopup['status'], remarks?: string) => void;
}) {
  const issuable = group.actions.filter(isIssuableAction);
  const selectedActions = issuable.filter((a) => selected[a.id]);
  const allSelected = issuable.length > 0 && selectedActions.length === issuable.length;
  const issueSelectedBusy = busyKey === bulkActionKey('Completed', selectedActions);
  const waitingSelectedBusy = busyKey === bulkActionKey('In Progress', selectedActions);
  const issueAllBusy = busyKey === bulkActionKey('Completed', issuable);
  const highCount = group.actions.filter((a) => a.priority === 'High').length;
  const notReadyCount = group.actions.filter((a) => a.category === 'not_ready').length;
  const topupCount = group.actions.filter((a) => a.category === 'topup').length;
  const expiryCount = group.actions.filter((a) => a.category === 'expiry').length;
  const overdueCount = group.actions.filter((a) => a.category === 'overdue').length;

  return (
    <section className="card overflow-hidden" data-tour="topup-box-group">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{group.boxCode}</h3>
            <Badge tone={notReadyCount > 0 || overdueCount > 0 ? 'bad' : 'warn'}>
              {group.actions.length} action{group.actions.length === 1 ? '' : 's'}
            </Badge>
            {highCount > 0 && <Badge tone="bad">{highCount} high</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {group.boxName}{group.area ? ` - ${group.area}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {notReadyCount > 0 && <Badge tone="bad">{notReadyCount} not ready</Badge>}
          {topupCount > 0 && <Badge tone="warn">{topupCount} top-up</Badge>}
          {expiryCount > 0 && <Badge tone="warn">{expiryCount} expiry</Badge>}
          {overdueCount > 0 && <Badge tone="bad">{overdueCount} overdue</Badge>}
        </div>
      </div>

      {isAdmin && issuable.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <button
            type="button"
            className="btn btn-md btn-secondary"
            onClick={() => onToggle(issuable.map((a) => a.id), !allSelected)}
          >
            {allSelected ? 'Clear ticks' : 'Tick all open'}
          </button>
          <button
            type="button"
            className="btn btn-md btn-secondary"
            disabled={selectedActions.length === 0 || Boolean(busyKey)}
            onClick={() => onSetStatus(selectedActions, 'In Progress', 'Waiting stock')}
          >
            {waitingSelectedBusy ? <Spinner className="h-4 w-4" /> : 'Mark waiting stock'}
          </button>
          <button
            type="button"
            className="btn btn-md bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={selectedActions.length === 0 || Boolean(busyKey)}
            onClick={() => onSetStatus(selectedActions, 'Completed')}
          >
            {issueSelectedBusy ? <Spinner className="h-4 w-4" /> : `Issue selected (${selectedActions.length})`}
          </button>
          <button
            type="button"
            className="btn btn-md btn-primary"
            disabled={issuable.length === 0 || Boolean(busyKey)}
            onClick={() => onSetStatus(issuable, 'Completed')}
          >
            {issueAllBusy ? <Spinner className="h-4 w-4" /> : 'Issue all open'}
          </button>
        </div>
      )}

      <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {group.actions.map((action) => (
          <DashboardActionItem
            key={action.id}
            action={action}
            isAdmin={isAdmin}
            checked={Boolean(selected[action.id])}
            onToggle={(checked) => onToggle([action.id], checked)}
          />
        ))}
      </div>
    </section>
  );
}

function DashboardActionItem({
  action,
  isAdmin,
  checked,
  onToggle,
}: {
  action: DashboardAction;
  isAdmin: boolean;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const issuable = isIssuableAction(action);
  return (
    <div className={`flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2 ${issuable ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
      {isAdmin && (
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0 accent-brand"
          disabled={!issuable}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Select ${action.itemName}`}
        />
      )}
      <TopupThumb url={action.itemPhotoUrl} name={action.itemName} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="truncate font-semibold">{action.itemName}</span>
          <PriorityBadge priority={action.priority} />
          <Badge tone={actionTone(action.category)}>{actionCategoryLabel(action.category)}</Badge>
          {action.topupId && <Badge tone={topupStatusTone(action.status as ReportTopup['status'])}>{action.status}</Badge>}
        </div>
        <p className="mt-1 truncate text-xs text-slate-500">{action.requiredAction}</p>
        {action.expiryDate && <p className="text-xs text-slate-500">Exp {formatDate(action.expiryDate)}</p>}
      </div>
      <a href={action.href} className="btn btn-md btn-secondary shrink-0 px-3 py-2 text-xs">
        View
      </a>
    </div>
  );
}

function MasterDataCleanup({ dashboard }: { dashboard: ReportsResponse['dashboard'] }) {
  const incomplete = dashboard.items_expiry_verification + dashboard.items_baseline_missing;
  return (
    <section className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Master Data Cleanup</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <Badge tone={dashboard.items_missing_photo > 0 ? 'warn' : 'ok'}>
              {dashboard.items_missing_photo} missing reference photo
            </Badge>
            <Badge tone={dashboard.items_baseline_missing > 0 ? 'warn' : 'ok'}>
              {dashboard.items_baseline_missing} expiry baseline missing
            </Badge>
            <Badge tone={incomplete > 0 ? 'warn' : 'ok'}>{incomplete} incomplete master data</Badge>
          </div>
        </div>
        <a href="/admin?tab=box-items" className="btn btn-md btn-secondary">
          Review
        </a>
      </div>
    </section>
  );
}

function toneToClass(t: ReportTone) {
  return t === 'ok' ? 'status-ok' : t === 'warn' ? 'status-warn' : t === 'bad' ? 'status-bad' : 'status-neutral';
}

function actionTone(category: ActionCategory): ReportTone {
  return category === 'not_ready' || category === 'overdue' ? 'bad' : 'warn';
}

function actionCategoryLabel(category: ActionCategory) {
  if (category === 'not_ready') return 'Not ready';
  if (category === 'topup') return 'Top-up';
  if (category === 'expiry') return 'Expiry';
  return 'Overdue';
}

function isIssuableAction(action: DashboardAction) {
  return Boolean(action.topupId) && (action.status === 'Open' || action.status === 'In Progress');
}

function bulkActionKey(status: ReportTopup['status'], actions: DashboardAction[]) {
  const ids = actions.map((a) => a.topupId).filter(Boolean).join(',');
  return `${status}:${ids}`;
}

function groupDashboardActionsByBox(
  actions: DashboardAction[],
  boxById: Map<string, BoxLite>,
): DashboardActionGroup[] {
  const groups = new Map<string, DashboardActionGroup>();
  for (const action of actions) {
    const box = boxById.get(action.boxId);
    const group =
      groups.get(action.boxId) ??
      {
        boxId: action.boxId,
        boxCode: action.boxCode,
        boxName: box?.box_name ?? action.boxName,
        area: box?.area ?? action.area,
        actions: [],
        sortRank: action.sortRank,
      };
    group.actions.push(action);
    group.sortRank = Math.min(group.sortRank, action.sortRank);
    groups.set(action.boxId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      actions: group.actions.sort(
        (a, b) =>
          a.sortRank - b.sortRank ||
          (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3) ||
          a.itemName.localeCompare(b.itemName),
      ),
    }))
    .sort((a, b) => a.sortRank - b.sortRank || a.boxCode.localeCompare(b.boxCode));
}

function ReportsArchive({
  data,
  issueType,
  boxById,
  filters,
  insights,
}: {
  data: ReportsResponse;
  issueType: string;
  boxById: Map<string, BoxLite>;
  filters: ReactNode;
  insights: { name: string; usageCount: number; shortageCount: number }[];
}) {
  return (
    <section className="space-y-5">
      {filters}
      {insights.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">High consumption items detected</h2>
          <ul className="mt-1 space-y-1 text-sm text-amber-800">
            {insights.map((i) => (
              <li key={i.name}>
                <strong className="capitalize">{i.name}</strong> was taken {i.usageCount} times and flagged short in{' '}
                {i.shortageCount} inspection{i.shortageCount === 1 ? '' : 's'}.
              </li>
            ))}
          </ul>
        </section>
      )}
      <SectionTitle title="Inspection history and audit PDFs" subtitle="Auditor evidence lives here, away from the daily action queue." />
      <InspectionsReport data={data} boxById={boxById} />
      <SectionTitle title="Usage this month" subtitle="Usage logs and CSV export for historical review." />
      <UsageReport data={data} boxById={boxById} />
      <SectionTitle title="Historical item issues" subtitle="Expiry, shortage and verification records for traceability." />
      <IssuesReport data={data} issueType={issueType} boxById={boxById} />
    </section>
  );
}

function BoxesReadiness({
  data,
  boxes,
  boxById,
}: {
  data: ReportsResponse;
  boxes: BoxLite[];
  boxById: Map<string, BoxLite>;
  onJump: (filter: ActionFilter) => void;
}) {
  const actions = useMemo(() => buildActionQueue(data, boxes, boxById), [data, boxes, boxById]);
  const actionByBox = useMemo(() => {
    const map = new Map<string, DashboardAction[]>();
    for (const action of actions) {
      const list = map.get(action.boxId) ?? [];
      list.push(action);
      map.set(action.boxId, list);
    }
    return map;
  }, [actions]);
  const lastByBox = useMemo(() => latestInspectionByBox(data.inspections), [data.inspections]);
  const rows = boxes
    .map((box) => {
      const due = computeDue({
        lastInspectionAt: lastByBox.get(box.id) ?? null,
        boxCreatedAt: box.created_at,
        frequencyDays: box.inspection_frequency_days,
        now: new Date(),
      });
      const boxActions = actionByBox.get(box.id) ?? [];
      const notReady = boxActions.some((a) => a.category === 'not_ready');
      const readiness = due.due_status === 'Overdue' ? 'Overdue' : notReady ? 'Not ready' : boxActions.length > 0 ? 'Action required' : 'Ready';
      const tone: ReportTone = readiness === 'Ready' ? 'ok' : readiness === 'Action required' ? 'warn' : 'bad';
      return { box, due, boxActions, readiness, tone };
    })
    .sort((a, b) => readinessRank(a.readiness) - readinessRank(b.readiness) || a.box.box_code.localeCompare(b.box.box_code));

  return (
    <section className="space-y-3">
      <SectionTitle title="Box readiness" subtitle="Scan by first aid box, then open the action queue for the boxes that need work." />
      {rows.map(({ box, due, boxActions, readiness, tone }) => (
        <article key={box.id} className="card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">{box.box_code}</h2>
                <Badge tone={tone}>{readiness}</Badge>
              </div>
              <p className="text-sm text-slate-600">
                {box.box_name}{box.area ? ` - ${box.area}` : ''}
              </p>
            </div>
            <a href={`/admin/dashboard?tab=action&box_id=${encodeURIComponent(box.id)}`} className="btn btn-md btn-secondary">
              View
            </a>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <MiniFact label="Last inspection" value={formatDate(lastByBox.get(box.id) ?? null)} />
            <MiniFact label="Open actions" value={String(boxActions.length)} strong={boxActions.length > 0} />
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Inspection status</p>
              <div className="mt-1">
                <DueBadge status={due.due_status} daysOverdue={due.days_overdue} />
              </div>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function buildActionQueue(data: ReportsResponse, boxes: BoxLite[], boxById: Map<string, BoxLite>): DashboardAction[] {
  const actions: DashboardAction[] = [];
  const now = new Date();
  const today = todayIso();
  const in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const activeTopups = data.topup_requests.filter((r) => r.status === 'Open' || r.status === 'In Progress');
  const activeTopupKeys = new Set(activeTopups.map((r) => actionKey(r.box_id, r.item_name)));

  for (const r of activeTopups) {
    const box = boxById.get(r.box_id);
    const category = classifyTopup(r);
    const priority = r.priority ?? (category === 'not_ready' ? 'High' : 'Medium');
    actions.push({
      id: `topup:${r.id}`,
      category,
      priority,
      boxId: r.box_id,
      boxCode: boxLabel(box, r.box_id),
      boxName: box?.box_name ?? 'Unknown box',
      area: box?.area ?? 'Unassigned area',
      itemName: r.item_name,
      itemPhotoUrl: r.item_photo_url,
      issue: r.reason ?? topupIssueFallback(r),
      requiredAction: topupRequiredAction(r, category),
      observed: topupObservedText(r),
      required: topupRequiredText(r),
      expiryDate: r.expiry_date,
      status: r.status,
      sortRank: categoryRank(category, priority),
      requestedAt: r.requested_at,
      topupId: r.id,
      href: `/admin/dashboard?tab=action&box_id=${encodeURIComponent(r.box_id)}`,
    });
  }

  for (const r of data.expiry_items) {
    if (activeTopupKeys.has(actionKey(r.box_id, r.item_name))) continue;
    if (r.expiry_status === 'Expiring soon' && (!r.expiry_date || r.expiry_date > in30)) continue;
    const box = boxById.get(r.box_id);
    const category: ActionCategory = r.expiry_status === 'Expired' ? 'not_ready' : 'expiry';
    const priority = r.expiry_status === 'Expired' ? 'High' : 'Medium';
    actions.push({
      id: `expiry:${r.id}`,
      category,
      priority,
      boxId: r.box_id,
      boxCode: boxLabel(box, r.box_id),
      boxName: box?.box_name ?? 'Unknown box',
      area: box?.area ?? 'Unassigned area',
      itemName: r.item_name,
      itemPhotoUrl: null,
      issue: expiryIssueText(r.expiry_status),
      requiredAction: expiryAction(r.expiry_status),
      observed: r.expiry_status,
      required: 'Valid expiry record',
      expiryDate: r.expiry_date,
      status: r.expiry_status,
      sortRank: categoryRank(category, priority) + (r.expiry_status === 'No expiry date recorded' ? 3 : 0),
      requestedAt: r.last_verified_date ?? today,
      href: `/admin?tab=box-items`,
    });
  }

  const lastByBox = latestInspectionByBox(data.inspections);
  for (const box of boxes) {
    const due = computeDue({
      lastInspectionAt: lastByBox.get(box.id) ?? null,
      boxCreatedAt: box.created_at,
      frequencyDays: box.inspection_frequency_days,
      now,
    });
    if (due.due_status !== 'Overdue') continue;
    actions.push({
      id: `overdue:${box.id}`,
      category: 'overdue',
      priority: 'High',
      boxId: box.id,
      boxCode: box.box_code,
      boxName: box.box_name,
      area: box.area ?? 'Unassigned area',
      itemName: 'Inspection overdue',
      itemPhotoUrl: null,
      issue: `${due.days_overdue} day${due.days_overdue === 1 ? '' : 's'} overdue`,
      requiredAction: 'Complete inspection now',
      observed: formatDate(lastByBox.get(box.id) ?? null),
      required: `Every ${box.inspection_frequency_days} days`,
      expiryDate: null,
      status: 'Overdue',
      sortRank: categoryRank('overdue', 'High'),
      requestedAt: due.next_due_date,
      href: `/inspect/${box.id}`,
    });
  }

  return actions.sort((a, b) => a.sortRank - b.sortRank || new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());
}

function actionCounts(actions: DashboardAction[]) {
  return {
    notReady: actions.filter((a) => a.category === 'not_ready').length,
    topup: actions.filter((a) => a.category === 'topup').length,
    expiry: actions.filter((a) => a.category === 'expiry').length,
    overdue: actions.filter((a) => a.category === 'overdue').length,
  };
}

function latestInspectionByBox(rows: ReportsResponse['inspections']) {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.box_id)) map.set(row.box_id, row.created_at);
  }
  return map;
}

function actionKey(boxId: string, itemName: string) {
  return `${boxId}:${itemName.trim().toLowerCase()}`;
}

function categoryRank(category: ActionCategory, priority: 'High' | 'Medium' | 'Low') {
  const categoryOrder: Record<ActionCategory, number> = { not_ready: 0, topup: 2, expiry: 3, overdue: 4 };
  const priorityOrder: Record<'High' | 'Medium' | 'Low', number> = { High: 0, Medium: 1, Low: 2 };
  return categoryOrder[category] * 10 + priorityOrder[priority];
}

function classifyTopup(r: ReportTopup): ActionCategory {
  const text = `${r.reason ?? ''} ${r.item_name}`.toLowerCase();
  if (/expired|missing|empty|damaged|out of stock|quantity 0/.test(text)) return 'not_ready';
  if (/expiring|expiry/.test(text)) return 'expiry';
  return 'topup';
}

function topupIssueFallback(r: ReportTopup) {
  if (r.observed_quantity !== null && r.observed_quantity !== undefined && r.required_quantity !== null && r.required_quantity !== undefined) {
    return r.observed_quantity < r.required_quantity ? 'Quantity below required' : 'Restock requested';
  }
  if (r.observed_volume_level) return `Volume ${r.observed_volume_level.toLowerCase()}`;
  return 'Top-up requested';
}

function topupRequiredAction(r: ReportTopup, category: ActionCategory) {
  const unit = r.unit?.trim() || 'pcs';
  if (category === 'not_ready') return /expired/i.test(r.reason ?? '') ? 'Replace item now' : 'Issue or replace before box is ready';
  if (category === 'expiry') return 'Plan replacement before expiry';
  if (r.required_quantity != null && r.observed_quantity != null && r.required_quantity > r.observed_quantity) {
    return `Top up ${r.required_quantity - r.observed_quantity} ${unit}`;
  }
  if (r.observed_volume_level) return 'Top up or replace';
  return 'Top up to required level';
}

function topupObservedText(r: ReportTopup) {
  if (r.observed_quantity !== null && r.observed_quantity !== undefined) {
    return `${r.observed_quantity}${r.unit ? ` ${r.unit}` : ''}`;
  }
  return r.observed_volume_level ?? '-';
}

function topupRequiredText(r: ReportTopup) {
  if (r.required_quantity !== null && r.required_quantity !== undefined) {
    return `${r.required_quantity}${r.unit ? ` ${r.unit}` : ''}`;
  }
  return r.expiry_date ? 'Before expiry' : '-';
}

function expiryIssueText(status: ReportsResponse['expiry_items'][number]['expiry_status']) {
  if (status === 'Expired') return 'Item expired';
  if (status === 'Expiring soon') return 'Expiring within 30 days';
  if (status === 'Expiry label mismatch') return 'Expiry label mismatch';
  if (status === 'No expiry date recorded') return 'No expiry baseline recorded';
  return status;
}

function readinessRank(status: string) {
  if (status === 'Not ready') return 0;
  if (status === 'Overdue') return 1;
  if (status === 'Action required') return 2;
  return 3;
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
              data-tour="inspection-pdf"
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
          <a key="pdf" href={inspectionPdfHref(r.id)} download className="btn btn-md btn-secondary" data-tour="inspection-pdf">
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
            <div key={boxId} className="card overflow-hidden" data-tour="topup-box-group">
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
