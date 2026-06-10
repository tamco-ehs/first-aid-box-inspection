'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/StatusBadge';
import { ItemPhotoUploader } from './ItemPhotoUploader.tsx';
import { Notice, Section, useAsync, type TemplateItemRow, type TemplateRow } from './shared.tsx';

const UNIT_OPTIONS = ['pcs', 'set', 'pack', 'roll', 'pair', 'bottle', 'tube', 'box', 'tablet', 'sheet'] as const;

export function TemplateAdmin() {
  const sb = getSupabaseBrowserClient();
  const { data, loading, error, reload } = useAsync<{ templates: TemplateRow[]; items: TemplateItemRow[] }>(async () => {
    const [templates, items] = await Promise.all([
      sb.from('first_aid_kit_templates').select('id, template_name, is_active').order('template_name'),
      sb
        .from('first_aid_kit_template_items')
        .select('id, template_id, item_code, item_name, required_quantity, unit, measurement_type, has_expiry, expiry_warning_days, is_critical, item_photo_url, display_order, is_active')
        .order('display_order'),
    ]);
    return {
      templates: (templates.data ?? []) as unknown as TemplateRow[],
      items: (items.data ?? []) as unknown as TemplateItemRow[],
    };
  });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (loading) return <Spinner className="mx-auto my-12 h-7 w-7 text-slate-400" />;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {data.templates.map((t) => (
        <Section key={t.id} title={t.template_name} actions={<Badge tone={t.is_active ? 'ok' : 'neutral'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>}>
          <p className="mb-2 text-xs text-slate-500">
            Edit the baseline checklist. Changes apply to new boxes; existing boxes keep their items
            until re-synced.
          </p>
          <div className="space-y-3">
            {data.items
              .filter((i) => i.template_id === t.id)
              .map((item) => (
                <TemplateItemEditor
                  key={item.id}
                  item={item}
                  onSaved={() => {
                    setMsg({ kind: 'ok', text: `Saved ${item.item_name}.` });
                    reload();
                  }}
                  onError={(text) => setMsg({ kind: 'error', text })}
                />
              ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

function TemplateItemEditor({
  item,
  onSaved,
  onError,
}: {
  item: TemplateItemRow;
  onSaved: () => void;
  onError: (t: string) => void;
}) {
  const sb = getSupabaseBrowserClient();
  const [f, setF] = useState(item);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const { error } = await sb
        .from('first_aid_kit_template_items')
        .update({
          item_name: f.item_name.trim(),
          required_quantity: f.required_quantity,
          unit: f.unit?.trim() || null,
          measurement_type: f.measurement_type,
          has_expiry: f.has_expiry,
          expiry_warning_days: Number(f.expiry_warning_days) || 60,
          is_critical: f.is_critical,
          display_order: Number(f.display_order) || 0,
        })
        .eq('id', item.id);
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    const { error } = await sb.from('first_aid_kit_template_items').update({ is_active: !item.is_active }).eq('id', item.id);
    if (error) onError(error.message);
    else onSaved();
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-3">
        <ItemPhotoUploader
          target={{ template_item_id: item.id }}
          currentUrl={item.item_photo_url}
          name={item.item_name}
          onChanged={onSaved}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <L label="Name" wide>
          <input className="input" value={f.item_name} onChange={(e) => setF({ ...f, item_name: e.target.value })} />
        </L>
        <L label="Required qty">
          <input type="number" min={0} className="input" value={f.required_quantity ?? ''} onChange={(e) => setF({ ...f, required_quantity: e.target.value === '' ? null : Number(e.target.value) })} />
        </L>
        <L label="Unit">
          <select
            className="select"
            value={f.unit ?? ''}
            onChange={(e) => setF({ ...f, unit: e.target.value || null })}
          >
            <option value="">None</option>
            {f.unit && !UNIT_OPTIONS.includes(f.unit as (typeof UNIT_OPTIONS)[number]) && (
              <option value={f.unit}>{f.unit}</option>
            )}
            {UNIT_OPTIONS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </L>
        <L label="Measurement">
          <select className="select" value={f.measurement_type} onChange={(e) => setF({ ...f, measurement_type: e.target.value as TemplateItemRow['measurement_type'] })}>
            <option value="quantity">Quantity</option>
            <option value="volume_level">Volume level</option>
            <option value="present_absent">Present / absent</option>
          </select>
        </L>
        <L label="Expiry warning (days)">
          <input type="number" min={0} className="input" value={f.expiry_warning_days} onChange={(e) => setF({ ...f, expiry_warning_days: Number(e.target.value) })} />
        </L>
        <L label="Order">
          <input type="number" className="input" value={f.display_order} onChange={(e) => setF({ ...f, display_order: Number(e.target.value) })} />
        </L>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" checked={f.has_expiry} onChange={(e) => setF({ ...f, has_expiry: e.target.checked })} /> Has expiry
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" checked={f.is_critical} onChange={(e) => setF({ ...f, is_critical: e.target.checked })} /> Critical
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={busy} className="btn btn-md btn-primary">
          {busy ? <Spinner className="h-4 w-4" /> : 'Save'}
        </button>
        <button onClick={toggleActive} className="btn btn-md btn-secondary">
          {item.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </div>
  );
}

function L({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'col-span-2' : ''}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
