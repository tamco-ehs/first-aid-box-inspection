'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api.ts';
import type { ActionsResponse, Me } from '@/lib/client/types.ts';
import { formatDate } from '@/lib/client/format.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { BottomNav } from '@/components/BottomNav';
import { EshNav } from '@/components/esh/EshNav';
import { Spinner } from '@/components/Spinner';
import { ActionStatusBadge, PriorityBadge } from '@/components/StatusBadge';

const STATUSES = ['Open', 'In Progress', 'Closed', 'all'] as const;

export default function ActionsPage() {
  return <RequireAuth>{(me) => <Actions me={me} />}</RequireAuth>;
}

function Actions({ me }: { me: Me }) {
  const isEsh = me.role === 'admin' || me.role === 'viewer';
  const canClose = me.role === 'admin';
  const [status, setStatus] = useState<string>('Open');
  const [data, setData] = useState<ActionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api
      .actions(`status=${status}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [status]);

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
            <button key={s} onClick={() => setStatus(s)} className={`btn btn-md ${status === s ? 'btn-primary' : 'btn-secondary'}`}>
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        {!data && !error && (
          <div className="flex justify-center py-12 text-slate-400"><Spinner className="h-7 w-7" /></div>
        )}

        {data && data.actions.length === 0 && (
          <div className="card p-8 text-center text-slate-500">No actions in this status.</div>
        )}

        {data?.actions.map((a) => {
          const inner = (
            <div className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{a.boxes?.box_code ?? '—'}</span>
                  <ActionStatusBadge status={a.status} />
                </div>
                <p className="text-sm">{a.action_type}{a.item_name ? ` · ${a.item_name}` : ''}</p>
                <p className="text-xs text-slate-500">{a.action_code} · {formatDate(a.created_at)}</p>
              </div>
              {a.priority && <PriorityBadge priority={a.priority} />}
            </div>
          );
          return canClose && a.status !== 'Closed' && a.status !== 'Rejected' ? (
            <a key={a.id} href={`/actions/${a.id}`} className="block hover:opacity-90">{inner}</a>
          ) : (
            <div key={a.id}>{inner}</div>
          );
        })}
      </main>
      {!isEsh && <BottomNav />}
    </>
  );
}
