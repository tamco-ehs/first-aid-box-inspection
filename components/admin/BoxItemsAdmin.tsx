'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/Spinner';
import { ItemPhotoUploader } from './ItemPhotoUploader.tsx';
import { Notice, Section, useAsync, type AdminBox, type BoxItemRow } from './shared.tsx';

export function BoxItemsAdmin() {
  const sb = getSupabaseBrowserClient();
  const boxes = useAsync<AdminBox[]>(async () => {
    const { data } = await sb
      .from('boxes')
      .select('id, box_code, box_name, location_description, area, template_id, inspection_frequency_days, is_active')
      .eq('is_active', true)
      .order('box_code');
    return (data ?? []) as unknown as AdminBox[];
  });

  const [boxId, setBoxId] = useState('');
  const [items, setItems] = useState<BoxItemRow[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function loadItems(id: string) {
    if (!id) {
      setItems(null);
      return;
    }
    setLoadingItems(true);
    const { data, error } = await sb
      .from('box_items')
      .select('id, box_id, item_name, required_quantity, unit, measurement_type, has_expiry, expiry_date, expiry_status, last_verified_date, last_replaced_date, item_photo_url, is_active')
      .eq('box_id', id)
      .eq('is_active', true)
      .order('item_name');
    if (error) setMsg({ kind: 'error', text: error.message });
    setItems((data ?? []) as unknown as BoxItemRow[]);
    setLoadingItems(false);
  }

  useEffect(() => {
    loadItems(boxId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxId]);

  if (boxes.loading) return <Spinner className="mx-auto my-12 h-7 w-7 text-slate-400" />;

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Section title="Per-box item overrides">
        <p className="mb-3 text-xs text-slate-500">
          Override the expected quantity, expected expiry date, or reference photo for a specific box.
          A box photo override wins over the template photo.
        </p>
        <select className="select" value={boxId} onChange={(e) => setBoxId(e.target.value)}>
          <option value="">Select a box…</option>
          {(boxes.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.box_code} — {b.box_name}
            </option>
          ))}
        </select>
      </Section>

      {loadingItems && <Spinner className="mx-auto my-6 h-6 w-6 text-slate-400" />}

      {items && items.length === 0 && <Notice kind="error">This box has no items. Assign a template and create the box again, or contact support.</Notice>}

      {items &&
        items.map((item) => (
          <BoxItemEditor
            key={item.id}
            item={item}
            onSaved={() => {
              setMsg({ kind: 'ok', text: `Saved ${item.item_name}.` });
              loadItems(boxId);
            }}
            onError={(text) => setMsg({ kind: 'error', text })}
          />
        ))}
    </div>
  );
}

function BoxItemEditor({
  item,
  onSaved,
  onError,
}: {
  item: BoxItemRow;
  onSaved: () => void;
  onError: (t: string) => void;
}) {
  const sb = getSupabaseBrowserClient();
  const [requiredQty, setRequiredQty] = useState(item.required_quantity);
  const [expiry, setExpiry] = useState(item.expiry_date ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const { error } = await sb
        .from('box_items')
        .update({
          required_quantity: requiredQty,
          expiry_date: expiry || null,
          expiry_status: item.has_expiry ? expiryStatus(expiry || null) : 'Valid',
        })
        .eq('id', item.id);
      if (error) throw new Error(error.message);
      if (item.has_expiry && (item.expiry_date ?? '') !== expiry) {
        const { data: authData } = await sb.auth.getUser();
        const { error: auditError } = await sb.from('expiry_audit_logs').insert({
          box_id: item.box_id,
          box_item_id: item.id,
          old_expiry_date: item.expiry_date,
          new_expiry_date: expiry || null,
          changed_by: authData.user?.id ?? null,
          reason: 'Admin correction from box item editor.',
          source: 'admin_correction',
        });
        if (auditError) throw new Error(auditError.message);
      }
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={item.item_name}>
      <div className="mb-3">
        <ItemPhotoUploader target={{ box_item_id: item.id }} currentUrl={item.item_photo_url} name={item.item_name} onChanged={onSaved} />
        <p className="mt-1 text-xs text-slate-400">Leave empty to use the template reference photo.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Required quantity</span>
          <input
            type="number"
            min={0}
            className="input"
            value={requiredQty ?? ''}
            onChange={(e) => setRequiredQty(e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        {item.has_expiry && (
          <label className="block">
            <span className="label">Current stock expiry date</span>
            <input type="date" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            {item.expiry_status && <p className="mt-1 text-xs text-slate-500">Status: {item.expiry_status}</p>}
          </label>
        )}
      </div>
      <button onClick={save} disabled={busy} className="btn btn-md btn-primary mt-3">
        {busy ? <Spinner className="h-4 w-4" /> : 'Save'}
      </button>
    </Section>
  );
}

function expiryStatus(expiryDate: string | null): string {
  if (!expiryDate) return 'No expiry date recorded';
  const today = new Date().toISOString().slice(0, 10);
  if (expiryDate < today) return 'Expired';
  const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  if (expiryDate <= soon) return 'Expiring soon';
  return 'Valid';
}
