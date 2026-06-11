'use client';

import { useMemo } from 'react';
import type { DraftObservation } from '@/lib/client/draft.ts';
import type { PresentStatus, TemplateItem, VolumeLevel } from '@/lib/client/types.ts';
import { formatDate, todayIso } from '@/lib/client/format.ts';
import { evaluateItem } from '@/lib/logic/inspection.ts';
import type { ExpiryValidationStatus } from '@/lib/logic/types.ts';
import { hasObservation, toSpec } from '@/lib/client/inspect-helpers.ts';
import { ItemPhoto } from '@/components/ItemPhoto';
import { PhotoCapture } from '@/components/PhotoCapture';
import { Badge, ItemStatusBadge } from '@/components/StatusBadge';

const VOLUME_LEVELS: VolumeLevel[] = ['Full', 'Half', 'Empty'];
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

const EXPIRY_OPTIONS: [ExpiryValidationStatus, string][] = [
  ['matches_label', 'Matches label'],
  ['different_date', 'Different date'],
  ['no_label', 'No label'],
  ['expired', 'Expired'],
  ['replaced_now', 'Replaced now'],
];

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
      ? `Required: ${item.required_quantity ?? '-'} ${item.unit ?? ''}`.trim()
      : item.measurement_type === 'volume_level'
        ? 'Check fill level'
        : 'Check presence / condition';
  const hasIssue = Boolean(live && (live.topup_required || live.item_status !== 'OK'));
  const expiryChoice: ExpiryValidationStatus | null =
    value.expiry_validation_status ??
    (value.expiry_quick_option === 'no_label'
      ? 'no_label'
      : value.expiry_quick_option === 'expired'
        ? 'expired'
        : null);

  function setExpiryChoice(status: ExpiryValidationStatus) {
    const patch: Partial<DraftObservation> = {
      expiry_validation_status: status,
      expiry_quick_option: null,
    };
    if (status === 'matches_label' || status === 'no_label' || status === 'expired' || status === 'missing_not_replaced') {
      patch.expiry_date = null;
    }
    if (status === 'different_date') {
      patch.expiry_date = value.expiry_date ?? item.current_expiry_date ?? null;
    }
    if (status === 'replaced_now') {
      patch.expiry_date = value.expiry_date ?? null;
      patch.replacement_date = value.replacement_date ?? todayIso();
      if (item.measurement_type === 'quantity') patch.observed_quantity = item.required_quantity ?? value.observed_quantity ?? 1;
      if (item.measurement_type === 'volume_level') patch.observed_volume_level = 'Full';
      if (item.measurement_type === 'present_absent') patch.observed_present_status = 'Present';
    }
    if ((status === 'no_label' || status === 'expired' || status === 'missing_not_replaced') && !value.remarks?.trim()) {
      patch.remarks =
        status === 'no_label'
          ? 'No expiry label found.'
          : status === 'expired'
            ? 'Physical item is expired.'
            : 'Item missing and not replaced during inspection.';
    }
    set(patch);
  }

  return (
    <div className="card p-3">
      <div className="flex gap-3">
        <ItemPhoto url={item.item_photo_url} name={item.item_name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight">{item.item_name}</h3>
            {live ? <ItemStatusBadge status={live.item_status} /> : <Badge tone="neutral">Pending</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {requiredLabel}
            {item.is_critical && <span className="ml-2 font-semibold text-red-600">Critical</span>}
          </p>
        </div>
      </div>

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

      {item.has_expiry && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="label">Expiry validation</span>
              <p className="text-sm font-semibold">
                System date: {item.current_expiry_date ? formatDate(item.current_expiry_date) : 'Not recorded'}
              </p>
            </div>
            {item.expiry_status && (
              <Badge
                tone={
                  item.expiry_status === 'Expired' || item.expiry_status === 'No expiry date recorded'
                    ? 'bad'
                    : item.expiry_status === 'Valid'
                      ? 'ok'
                      : 'warn'
                }
              >
                {item.expiry_status}
              </Badge>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {EXPIRY_OPTIONS.map(([status, label]) => (
              <button
                type="button"
                key={status}
                onClick={() => setExpiryChoice(status)}
                className={`btn btn-secondary min-h-11 px-3 text-sm ${
                  expiryChoice === status ? 'border-brand bg-red-50 text-brand' : ''
                } ${status === 'replaced_now' ? 'col-span-2' : ''}`}
                aria-pressed={expiryChoice === status}
              >
                {label}
              </button>
            ))}
          </div>

          {(expiryChoice === 'different_date' || expiryChoice === 'replaced_now') && (
            <div className="mt-3 grid gap-3">
              <label className="block">
                <span className="label">New expiry date</span>
                <input
                  type="date"
                  className="input min-h-12 py-2"
                  value={value.expiry_date ?? ''}
                  onChange={(e) => set({ expiry_date: e.target.value || null, expiry_quick_option: null })}
                />
              </label>
              {expiryChoice === 'replaced_now' && (
                <>
                  <label className="block">
                    <span className="label">Replacement date</span>
                    <input
                      type="date"
                      className="input min-h-12 py-2"
                      value={value.replacement_date ?? todayIso()}
                      onChange={(e) => set({ replacement_date: e.target.value || null })}
                    />
                  </label>
                  <div>
                    <span className="label">Replacement photo (optional)</span>
                    <PhotoCapture
                      initialUrl={value.replacement_photo_url ?? null}
                      onChange={(next) =>
                        set({
                          replacement_photo_url: next?.url ?? null,
                          replacement_photo_cloudinary_public_id: next?.publicId ?? null,
                        })
                      }
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {expiryChoice === 'expired' && (
            <p className="mt-2 text-sm font-semibold text-red-700">Replacement will be required.</p>
          )}
        </div>
      )}

      <label className="mt-3 block">
        <span className="label">{hasIssue ? 'Remarks (required for issue)' : 'Remarks (optional)'}</span>
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
