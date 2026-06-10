'use client';

import { useMemo } from 'react';
import type { DraftObservation } from '@/lib/client/draft.ts';
import type { PresentStatus, TemplateItem, VolumeLevel } from '@/lib/client/types.ts';
import { evaluateItem } from '@/lib/logic/inspection.ts';
import { hasObservation, toSpec } from '@/lib/client/inspect-helpers.ts';
import { ItemPhoto } from '@/components/ItemPhoto';
import { Badge, ItemStatusBadge } from '@/components/StatusBadge';

const VOLUME_LEVELS: VolumeLevel[] = ['Full', 'Three Quarter', 'Half', 'Below Half', 'Empty'];
const VOLUME_TONE: Record<VolumeLevel, 'ok' | 'warn' | 'bad'> = {
  Full: 'ok',
  'Three Quarter': 'ok',
  Half: 'warn',
  'Below Half': 'warn',
  Empty: 'bad',
};
const PRESENT_OPTIONS: { value: PresentStatus; tone: 'ok' | 'warn' | 'bad' }[] = [
  { value: 'Present', tone: 'ok' },
  { value: 'Missing', tone: 'bad' },
  { value: 'Damaged', tone: 'warn' },
];

const toneClass = {
  on: {
    ok: 'choice-on-ok',
    warn: 'choice-on-warn',
    bad: 'choice-on-bad',
  },
};

export function ChecklistCard({
  item,
  value,
  onChange,
  now,
}: {
  item: TemplateItem;
  value: DraftObservation;
  onChange: (next: DraftObservation) => void;
  now: Date;
}) {
  const set = (patch: Partial<DraftObservation>) => onChange({ ...value, ...patch });

  const live = useMemo(() => {
    if (!hasObservation(item, value)) return null;
    return evaluateItem(toSpec(item), value, now);
  }, [item, value, now]);

  const requiredLabel =
    item.measurement_type === 'quantity'
      ? `Required: ${item.required_quantity ?? '—'} ${item.unit ?? ''}`.trim()
      : item.measurement_type === 'volume_level'
        ? 'Check fill level'
        : 'Check presence / condition';

  return (
    <div className="card p-4">
      <div className="flex gap-3">
        <ItemPhoto url={item.item_photo_url} name={item.item_name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight">{item.item_name}</h3>
            {live ? (
              <ItemStatusBadge status={live.item_status} />
            ) : (
              <Badge tone="neutral">Pending</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {requiredLabel}
            {item.is_critical && <span className="ml-2 font-semibold text-red-600">Critical</span>}
          </p>
        </div>
      </div>

      {/* Measurement input */}
      <div className="mt-3">
        {item.measurement_type === 'quantity' && (
          <label className="block">
            <span className="label">Current quantity</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className="input"
              placeholder={`e.g. ${item.required_quantity ?? 0}`}
              value={value.observed_quantity ?? ''}
              onChange={(e) =>
                set({
                  observed_quantity: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                })
              }
            />
          </label>
        )}

        {item.measurement_type === 'volume_level' && (
          <div className="flex flex-wrap gap-2">
            {VOLUME_LEVELS.map((lvl) => {
              const selected = value.observed_volume_level === lvl;
              return (
                <button
                  type="button"
                  key={lvl}
                  onClick={() => set({ observed_volume_level: lvl })}
                  className={`choice ${selected ? toneClass.on[VOLUME_TONE[lvl]] : ''}`}
                  aria-pressed={selected}
                >
                  {lvl}
                </button>
              );
            })}
          </div>
        )}

        {item.measurement_type === 'present_absent' && (
          <div className="flex gap-2">
            {PRESENT_OPTIONS.map((opt) => {
              const selected = value.observed_present_status === opt.value;
              return (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => set({ observed_present_status: opt.value })}
                  className={`choice ${selected ? toneClass.on[opt.tone] : ''}`}
                  aria-pressed={selected}
                >
                  {opt.value}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Expiry */}
      {item.has_expiry && (
        <label className="mt-3 block">
          <span className="label">
            Expiry date <span className="text-red-600">*</span>
          </span>
          <input
            type="date"
            className="input"
            value={value.expiry_date ?? ''}
            onChange={(e) => set({ expiry_date: e.target.value || null })}
          />
          {live?.is_expired && (
            <span className="mt-1 block text-sm font-bold text-red-600">⚠ Expired — replace immediately</span>
          )}
          {live?.expires_soon && (
            <span className="mt-1 block text-sm font-semibold text-amber-700">Expiring soon</span>
          )}
        </label>
      )}

      {/* Remarks */}
      <label className="mt-3 block">
        <span className="label">Remarks (optional)</span>
        <input
          type="text"
          className="input"
          maxLength={1000}
          value={value.remarks ?? ''}
          onChange={(e) => set({ remarks: e.target.value || null })}
        />
      </label>

      {live?.topup_required && (
        <p className="mt-2 text-sm font-medium text-amber-700">Top-up will be requested for this item.</p>
      )}
    </div>
  );
}
