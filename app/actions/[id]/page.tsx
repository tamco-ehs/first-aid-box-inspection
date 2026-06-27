'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client/api.ts';
import type { ActionRow, InspectionTemplateResponse, TemplateItem } from '@/lib/client/types.ts';
import { todayIso } from '@/lib/client/format.ts';
import { RequireAuth, AccessBlocked } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { Badge } from '@/components/StatusBadge';
import { Spinner, FullScreenLoader } from '@/components/Spinner';

interface ItemState {
  selected: boolean;
  after_refill_quantity: number | null;
  new_expiry_date: string;
}

export default function CloseActionPage() {
  const params = useParams<{ id: string }>();
  return <RequireAuth roles={['superadmin', 'admin']}>{() => <CloseAction actionId={params.id} />}</RequireAuth>;
}

function isActiveItemAction(action: ActionRow) {
  return (
    action.category === 'item' &&
    (action.status === 'Open' || action.status === 'In Progress') &&
    (action.action_type === 'Item Low Qty' ||
      action.action_type === 'Item Missing' ||
      action.action_type === 'Item Expired')
  );
}
function actionMatchesItem(action: ActionRow, item: TemplateItem) {
  return action.box_item_id === item.box_item_id || (action.box_item_id == null && action.item_name === item.item_name);
}

function CloseAction({ actionId }: { actionId: string }) {
  const today = todayIso();
  const [action, setAction] = useState<ActionRow | null>(null);
  const [activeActions, setActiveActions] = useState<ActionRow[]>([]);
  const [tpl, setTpl] = useState<InspectionTemplateResponse | null>(null);
  const [state, setState] = useState<Record<string, ItemState>>({});
  const [note, setNote] = useState('');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ box_ready: boolean; updated: number } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await api.actions('category=item');
        const a = list.actions.find((x) => x.id === actionId);
        if (!a) {
          if (active) setLoadErr('Action not found, already closed, or no longer active.');
          return;
        }
        const t = await api.inspectionTemplate(a.box_id);
        if (!active) return;
        const boxActions = list.actions.filter((x) => x.box_id === a.box_id && isActiveItemAction(x));
        setAction(a);
        setActiveActions(boxActions);
        setTpl(t);
        const init: Record<string, ItemState> = {};
        for (const it of t.items.filter((item) => boxActions.some((activeAction) => actionMatchesItem(activeAction, item)))) {
          init[it.box_item_id] = {
            selected: true,
            after_refill_quantity: it.required_quantity ?? it.current_quantity ?? null,
            new_expiry_date: it.has_expiry ? it.current_expiry_date ?? '' : '',
          };
        }
        setState(init);
      } catch (e) {
        if (active) setLoadErr(e instanceof Error ? e.message : 'Could not load the action.');
      }
    })();
    return () => {
      active = false;
    };
  }, [actionId, today]);

  const selectedCount = useMemo(() => Object.values(state).filter((s) => s.selected).length, [state]);
  const updateItems = useMemo(
    () =>
      tpl
        ? tpl.items.filter((item) => activeActions.some((activeAction) => actionMatchesItem(activeAction, item)))
        : [],
    [activeActions, tpl],
  );

  if (loadErr) return <AccessBlocked message={loadErr} />;
  if (!action || !tpl) return <FullScreenLoader label="Loading action…" />;

  if (done) {
    return (
      <>
        <AppHeader title="Action closed" subtitle={action.action_code} />
        <main className="mx-auto max-w-md space-y-4 p-6 text-center">
          <div className="text-5xl">✅</div>
          <p className="font-semibold">
            Updated {done.updated} item{done.updated === 1 ? '' : 's'}.
          </p>
          <p className="text-slate-600">
            Box is now <strong>{done.box_ready ? 'Ready' : 'Action Required'}</strong>.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <a href="/actions" className="btn btn-lg btn-secondary">Actions</a>
            <a href="/reports" className="btn btn-lg btn-primary">Dashboard</a>
          </div>
        </main>
      </>
    );
  }

  const setItem = (id: string, patch: Partial<ItemState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  const setAll = (selected: boolean) =>
    setState((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, selected }])));
  const selectRisk = () =>
    setState((s) => {
      const next = { ...s };
      for (const it of updateItems) next[it.box_item_id] = { ...next[it.box_item_id]!, selected: true };
      return next;
    });

  async function close() {
    if (saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const items = updateItems
        .filter((it) => state[it.box_item_id]?.selected)
        .map((it) => ({
          box_item_id: it.box_item_id,
          after_refill_quantity: state[it.box_item_id]!.after_refill_quantity,
          new_expiry_date: it.has_expiry ? state[it.box_item_id]!.new_expiry_date || null : null,
        }));
      const res = await api.closeAction({ action_id: actionId, closure_note: note.trim() || null, items });
      setDone({ box_ready: res.box_ready, updated: res.updated_items });
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Could not close the action.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AppHeader title="Close Action" subtitle={action.action_code} backHref="/actions" />
      <main className="mx-auto max-w-4xl space-y-4 p-4 pb-28">
        <section className="card p-4">
          <p className="text-sm font-semibold text-slate-500">{action.action_code}</p>
          <h2 className="text-lg font-bold">
            {action.boxes?.box_code ?? '—'} · {action.action_type}
          </h2>
          <p className="text-sm text-slate-500">
            {[action.boxes?.location_description, action.boxes?.area].filter(Boolean).join(' · ')}
          </p>
          {action.details && <p className="mt-1 text-sm text-slate-600">“{action.details}”</p>}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-medium">
            {selectedCount} item{selectedCount === 1 ? '' : 's'} selected for update
          </p>
          <div className="flex gap-2">
            <button onClick={selectRisk} className="btn btn-md btn-secondary">Select Risk</button>
            <button onClick={() => setAll(true)} className="btn btn-md btn-secondary">Select All</button>
            <button onClick={() => setAll(false)} className="btn btn-md btn-ghost text-slate-600">Clear</button>
          </div>
        </div>

        {saveErr && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{saveErr}</p>}

        <div className="space-y-2">
          {updateItems.length === 0 && (
            <div className="card p-8 text-center text-slate-500">No active action items require updates.</div>
          )}
          {updateItems.map((it) => {
            const st = state[it.box_item_id] ?? {
              selected: true,
              after_refill_quantity: it.required_quantity ?? it.current_quantity ?? null,
              new_expiry_date: it.has_expiry ? it.current_expiry_date ?? '' : '',
            };
            return (
              <div
                key={it.box_item_id}
                className={`card p-3 ${st.selected ? 'ring-2 ring-brand/40' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 accent-green-600"
                    checked={st.selected}
                    onChange={(e) => setItem(it.box_item_id, { selected: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{it.item_name}</span>
                      <QtyBadge current={it.current_quantity} required={it.required_quantity} />
                      <ExpiryBadge item={it} today={today} />
                    </div>
                    <p className="text-xs text-slate-500">
                      Current {it.current_quantity ?? 0} / Required {it.required_quantity ?? '?'}
                    </p>

                    <div className={`mt-2 grid gap-2 ${it.has_expiry ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                      <label className="block">
                        <span className="label">After refill</span>
                        <input
                          type="number"
                          min={0}
                          className="input"
                          value={st.after_refill_quantity ?? ''}
                          onChange={(e) =>
                            setItem(it.box_item_id, {
                              after_refill_quantity: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      {it.has_expiry && (
                        <label className="block">
                          <span className="label">New expiry</span>
                          <input
                            type="date"
                            className="input"
                            value={st.new_expiry_date}
                            onChange={(e) => setItem(it.box_item_id, { new_expiry_date: e.target.value })}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <label className="block">
          <span className="label">Closure note</span>
          <textarea className="textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-4xl">
          <button onClick={close} disabled={saving} className="btn btn-lg btn-primary w-full">
            {saving ? (
              <>
                <Spinner className="h-5 w-5" /> Updating…
              </>
            ) : (
              `Close & Update Box Item${selectedCount === 1 ? '' : 's'}`
            )}
          </button>
        </div>
      </div>
    </>
  );
}

function QtyBadge({ current, required }: { current: number | null; required: number | null }) {
  const c = current ?? 0;
  const r = required ?? 0;
  const tone = r > 0 && c >= r ? 'ok' : c > 0 ? 'warn' : 'bad';
  return <Badge tone={tone}>{c}/{required ?? '?'}</Badge>;
}

function ExpiryBadge({ item, today }: { item: TemplateItem; today: string }) {
  if (!item.has_expiry) return <Badge tone="neutral">Qty only</Badge>;
  if (!item.current_expiry_date) return <Badge tone="neutral">No date</Badge>;
  if (item.current_expiry_date < today) return <Badge tone="bad">Expired</Badge>;
  const days = Math.floor((new Date(item.current_expiry_date).getTime() - new Date(today).getTime()) / 86_400_000);
  if (days <= 90) return <Badge tone="warn">{days} Days</Badge>;
  return <Badge tone="ok">Valid</Badge>;
}
