'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client/api.ts';
import type { ActionRow, ActionsResponse, Me } from '@/lib/client/types.ts';
import { formatDate } from '@/lib/client/format.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { BottomNav } from '@/components/BottomNav';
import { EshNav } from '@/components/esh/EshNav';
import { Spinner } from '@/components/Spinner';
import { ActionStatusBadge, PriorityBadge } from '@/components/StatusBadge';

const STATUSES = ['Open', 'In Progress', 'Closed', 'all'] as const;

interface ActionGroup {
  boxId: string;
  boxCode: string;
  location: string;
  actions: ActionRow[];
}

export default function ActionsPage() {
  return <RequireAuth>{(me) => <Actions me={me} />}</RequireAuth>;
}

function Actions({ me }: { me: Me }) {
  const isEsh = me.role === 'admin' || me.role === 'viewer';
  const canClose = me.role === 'admin';
  const [status, setStatus] = useState<string>('Open');
  const [data, setData] = useState<ActionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openBoxId, setOpenBoxId] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    setOpenBoxId(null);
    api
      .actions(`status=${encodeURIComponent(status)}&category=item`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [status]);

  const groups = useMemo(() => groupActions(data?.actions ?? []), [data]);

  return (
    <>
      <AppHeader
        title="Actions"
        subtitle={me.full_name}
        right={isEsh ? <EshNav role={me.role} /> : undefined}
      />
      <main className="mx-auto max-w-4xl space-y-4 p-4 pb-24">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`btn btn-md ${status === s ? 'btn-primary' : 'btn-secondary'}`}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        {!data && !error && (
          <div className="flex justify-center py-12 text-slate-400">
            <Spinner className="h-7 w-7" />
          </div>
        )}

        {data && groups.length === 0 && (
          <div className="card p-8 text-center text-slate-500">No Low Stock, Missing, or Expired actions in this status.</div>
        )}

        <div className="space-y-3">
          {groups.map((group) => {
            const isOpen = openBoxId === group.boxId;
            const priority = highestPriority(group.actions);
            return (
              <section key={group.boxId} className="card overflow-hidden">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenBoxId(isOpen ? null : group.boxId)}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{group.boxCode}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {group.actions.length} action{group.actions.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {group.location && <p className="mt-1 truncate text-sm text-slate-500">{group.location}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {priority && <PriorityBadge priority={priority} />}
                    <span className="text-sm font-semibold text-brand">{isOpen ? 'Collapse' : 'Expand'}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 p-4">
                    <div className="divide-y divide-slate-100">
                      {group.actions.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold">{actionTitle(a)}</p>
                              <ActionStatusBadge status={a.status} />
                            </div>
                            <p className="text-xs text-slate-500">
                              {a.action_code} - {formatDate(a.created_at)}
                            </p>
                            {a.details && <p className="mt-1 text-sm text-slate-600">{a.details}</p>}
                          </div>
                          {canClose && a.status !== 'Closed' && a.status !== 'Rejected' ? (
                            <a href={`/actions/${a.id}`} className="btn btn-md btn-primary shrink-0">
                              Update
                            </a>
                          ) : (
                            a.priority && <PriorityBadge priority={a.priority} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>
      {!isEsh && <BottomNav />}
    </>
  );
}

function groupActions(actions: ActionRow[]): ActionGroup[] {
  const groups = new Map<string, ActionGroup>();
  for (const action of actions) {
    if (!isVisibleItemAction(action)) continue;
    const box = action.boxes;
    const existing = groups.get(action.box_id);
    if (existing) {
      existing.actions.push(action);
      continue;
    }
    groups.set(action.box_id, {
      boxId: action.box_id,
      boxCode: box?.box_code ?? 'Unknown box',
      location: [box?.location_description, box?.area].filter(Boolean).join(' - '),
      actions: [action],
    });
  }

  return [...groups.values()].sort((a, b) => a.boxCode.localeCompare(b.boxCode));
}

function isVisibleItemAction(action: ActionRow) {
  return (
    action.category === 'item' &&
    (action.action_type === 'Item Low Qty' ||
      action.action_type === 'Item Missing' ||
      action.action_type === 'Item Expired')
  );
}

function actionTitle(action: ActionRow) {
  const type = action.action_type === 'Item Low Qty' ? 'Item Low Stock' : action.action_type;
  return action.item_name ? `${type}: ${action.item_name}` : type;
}

function highestPriority(actions: ActionRow[]) {
  const rank = { High: 3, Medium: 2, Low: 1 } as const;
  return actions.reduce<ActionRow['priority']>((best, action) => {
    if (!action.priority) return best;
    if (!best || rank[action.priority] > rank[best]) return action.priority;
    return best;
  }, null);
}
