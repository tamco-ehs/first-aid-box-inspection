'use client';

import type { ItemDraft } from '@/lib/client/draft.ts';
import type { ItemCheckStatus, TemplateItem } from '@/lib/client/types.ts';
import { ItemPhoto } from '@/components/ItemPhoto';
import { formatDate } from '@/lib/client/format.ts';

const OPTIONS: { value: ItemCheckStatus; tone: 'ok' | 'warn' | 'bad'; requiresExpiry?: boolean }[] = [
  { value: 'OK', tone: 'ok' },
  { value: 'Low Qty', tone: 'warn' },
  { value: 'Missing', tone: 'bad' },
  { value: 'Expired', tone: 'bad', requiresExpiry: true },
];
const toneOn = { ok: 'choice-on-ok', warn: 'choice-on-warn', bad: 'choice-on-bad' };

// One simple item card: name, required/current, expiry, and the 4 status
// buttons (OK / Low Qty / Missing / Expired) with the small inputs each needs.
export function ItemCheckCard({
  item,
  value,
  onChange,
}: {
  item: TemplateItem;
  value: ItemDraft;
  onChange: (next: ItemDraft) => void;
}) {
  const set = (patch: Partial<ItemDraft>) => onChange({ ...value, ...patch });
  const status = value.status;
  const setStatus = (nextStatus: ItemCheckStatus) => {
    if (nextStatus === 'Low Qty') {
      onChange({
        status: nextStatus,
        observed_quantity: value.observed_quantity ?? null,
        new_expiry_date: null,
        remark: value.remark ?? null,
      });
      return;
    }
    if (nextStatus === 'Missing') {
      onChange({ status: nextStatus, observed_quantity: 0, new_expiry_date: null, remark: value.remark ?? null });
      return;
    }
    onChange({ status: nextStatus, observed_quantity: null, new_expiry_date: null, remark: null });
  };

  return (
    <div className="card p-4">
      <div className="flex gap-3">
        <ItemPhoto url={item.item_photo_url} name={item.item_name} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-tight">{item.item_name}</h3>
          <p className="mt-0.5 text-sm text-slate-600">
            Required: {item.required_quantity ?? '—'}
            {item.current_quantity != null && <> &nbsp;|&nbsp; Current: {item.current_quantity}</>}
          </p>
          <p className="text-xs text-slate-500">
            Expiry: {item.has_expiry ? formatDate(item.current_expiry_date) : 'Not applicable'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {OPTIONS.filter((o) => !o.requiresExpiry || item.has_expiry).map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setStatus(o.value)}
            aria-pressed={status === o.value}
            className={`choice ${status === o.value ? toneOn[o.tone] : ''}`}
          >
            {o.value}
          </button>
        ))}
      </div>

      {/* Conditional inputs */}
      {status === 'Low Qty' && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="label">Current quantity</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className="input"
              value={value.observed_quantity ?? ''}
              onChange={(e) =>
                set({ observed_quantity: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })
              }
            />
          </label>
          <RemarkInput value={value.remark} onChange={(v) => set({ remark: v })} />
        </div>
      )}

      {status === 'Missing' && (
        <div className="mt-3">
          <RemarkInput value={value.remark} onChange={(v) => set({ remark: v })} />
        </div>
      )}
    </div>
  );
}

function RemarkInput({
  value,
  onChange,
}: {
  value?: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="block">
      <span className="label">Remarks (optional)</span>
      <input
        type="text"
        className="input"
        maxLength={1000}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </label>
  );
}
