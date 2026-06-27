'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatDate, todayIso } from '@/lib/client/format.ts';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/StatusBadge';
import { Notice, Section } from './shared.tsx';

interface ExpiringItem {
  id: string;
  box_id: string;
  item_name: string;
  required_quantity: number | null;
  current_quantity: number | null;
  unit: string | null;
  expiry_date: string;
}

interface BoxInfo {
  id: string;
  box_code: string;
  box_name: string;
  location_description: string;
  area: string | null;
}

type Filter = 'expired' | 'soon' | 'all';

export function ExpiringItemsAdmin() {
  const sb = getSupabaseBrowserClient();
  const today = todayIso();
  const in30 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const [items, setItems] = useState<ExpiringItem[]>([]);
  const [boxes, setBoxes] = useState<Map<string, BoxInfo>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, { quantity: number | null; expiry: string }>>({});
  const [filter, setFilter] = useState<Filter>('expired');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    const [{ data: itemRows, error: itemErr }, { data: boxRows, error: boxErr }] = await Promise.all([
      sb
        .from('box_items')
        .select('id, box_id, item_name, required_quantity, current_quantity, unit, expiry_date')
        .eq('is_active', true)
        .eq('has_expiry', true)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', in30)
        .order('expiry_date', { ascending: true }),
      sb
        .from('boxes')
        .select('id, box_code, box_name, location_description, area')
        .eq('is_active', true),
    ]);

    if (itemErr || boxErr) {
      setMsg({ kind: 'error', text: itemErr?.message ?? boxErr?.message ?? 'Could not load expiring items.' });
      setLoading(false);
      return;
    }

    const boxMap = new Map(((boxRows ?? []) as BoxInfo[]).map((box) => [box.id, box]));
    const activeItems = ((itemRows ?? []) as (ExpiringItem & { expiry_date: string | null })[])
      .filter((item): item is ExpiringItem => Boolean(item.expiry_date && boxMap.has(item.box_id)))
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.item_name.localeCompare(b.item_name));

    setBoxes(boxMap);
    setItems(activeItems);
    setDrafts(
      Object.fromEntries(
        activeItems.map((item) => [
          item.id,
          { quantity: item.current_quantity ?? item.required_quantity ?? null, expiry: item.expiry_date },
        ]),
      ),
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = items.filter((item) => {
    if (filter === 'expired') return item.expiry_date < today;
    if (filter === 'soon') return item.expiry_date >= today && item.expiry_date <= in30;
    return true;
  });

  const expiredCount = items.filter((item) => item.expiry_date < today).length;
  const soonCount = items.filter((item) => item.expiry_date >= today && item.expiry_date <= in30).length;

  async function save(item: ExpiringItem) {
    const draft = drafts[item.id];
    if (!draft) return;
    setBusyId(item.id);
    setMsg(null);
    const { error } = await sb
      .from('box_items')
      .update({
        current_quantity: draft.quantity,
        expiry_date: draft.expiry || null,
      })
      .eq('id', item.id)
      .eq('is_active', true);
    if (error) {
      setMsg({ kind: 'error', text: error.message });
      setBusyId(null);
      return;
    }
    setMsg({ kind: 'ok', text: `Saved ${item.item_name}.` });
    setBusyId(null);
    await load();
  }

  if (loading) return <Spinner className="mx-auto my-12 h-7 w-7 text-slate-400" />;

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Section title="Expired and expiring items">
        <p className="mb-3 text-xs text-slate-500">
          Active box items that are expired or due to expire within 30 days. Update the quantity and expiry date after replacement.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFilter('expired')} className={`btn btn-md ${filter === 'expired' ? 'btn-primary' : 'btn-secondary'}`}>
            Expired ({expiredCount})
          </button>
          <button onClick={() => setFilter('soon')} className={`btn btn-md ${filter === 'soon' ? 'btn-primary' : 'btn-secondary'}`}>
            Expiring 30 days ({soonCount})
          </button>
          <button onClick={() => setFilter('all')} className={`btn btn-md ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}>
            All ({items.length})
          </button>
        </div>
      </Section>

      {visible.length === 0 && (
        <div className="card p-8 text-center text-slate-500">No items found for this view.</div>
      )}

      <div className="space-y-3">
        {visible.map((item) => {
          const box = boxes.get(item.box_id);
          const draft = drafts[item.id] ?? { quantity: item.current_quantity ?? null, expiry: item.expiry_date };
          const days = daysUntil(item.expiry_date, today);
          const expired = days < 0;
          return (
            <section key={item.id} className="card p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">{item.item_name}</h3>
                  <p className="text-sm text-slate-500">
                    {box?.box_code ?? 'Unknown box'} - {box?.box_name ?? 'Box'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {[box?.location_description, box?.area].filter(Boolean).join(' - ')}
                  </p>
                </div>
                <Badge tone={expired ? 'bad' : 'warn'}>
                  {expired ? `${Math.abs(days)} days expired` : `${days} days left`}
                </Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="label">Current quantity</span>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={draft.quantity ?? ''}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [item.id]: {
                          ...draft,
                          quantity: e.target.value === '' ? null : Number(e.target.value),
                        },
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="label">Required quantity</span>
                  <input className="input" value={item.required_quantity ?? ''} disabled />
                </label>
                <label className="block">
                  <span className="label">Expiry date</span>
                  <input
                    type="date"
                    className="input"
                    value={draft.expiry}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [item.id]: { ...draft, expiry: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>

              <button onClick={() => save(item)} disabled={busyId === item.id} className="btn btn-md btn-primary mt-3">
                {busyId === item.id ? <Spinner className="h-4 w-4" /> : 'Save'}
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function daysUntil(expiryDate: string, today: string) {
  const expiry = new Date(`${expiryDate}T00:00:00Z`).getTime();
  const start = new Date(`${today}T00:00:00Z`).getTime();
  return Math.ceil((expiry - start) / 86_400_000);
}
