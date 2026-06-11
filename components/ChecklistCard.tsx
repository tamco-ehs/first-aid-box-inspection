'use client';

import { useMemo, useState } from 'react';
import type { DraftObservation } from '@/lib/client/draft.ts';
import type { PresentStatus, TemplateItem, VolumeLevel } from '@/lib/client/types.ts';
import { formatDate, todayIso } from '@/lib/client/format.ts';
import { evaluateItem, remarksRequired } from '@/lib/logic/inspection.ts';
import type { ExpiryValidationStatus } from '@/lib/logic/types.ts';
import { hasObservation, toSpec } from '@/lib/client/inspect-helpers.ts';
import { ItemPhoto } from '@/components/ItemPhoto';
import { PhotoCapture } from '@/components/PhotoCapture';
import { Badge, FinalItemStatusBadge } from '@/components/StatusBadge';

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

type ExpiryAction = { status: ExpiryValidationStatus; label: string; full?: boolean };

export function ChecklistCard({
  item,
  value,
  onChange,
  onComplete,
  now,
}: {
  item: TemplateItem;
  value: DraftObservation;
  onChange: (next: DraftObservation) => void;
  /** Called on a decisive one-tap action so the page may auto-advance. NOT
   *  called for date/quantity/remarks edits (those would jump away mid-entry). */
  onComplete?: () => void;
  now: Date;
}) {
  const set = (patch: Partial<DraftObservation>) => onChange({ ...value, ...patch });

  const live = useMemo(() => {
    if (!hasObservation(item, value)) return null;
    return evaluateItem(toSpec(item), value, now);
  }, [item, value, now]);

  const previousQty = item.current_quantity;
  const hasSavedDate = Boolean(item.current_expiry_date);
  const savedExpired = item.expiry_status === 'Expired';
  const savedNeedsAttention =
    item.has_expiry &&
    (!hasSavedDate ||
      item.expiry_status === 'Expiry label mismatch' ||
      item.expiry_status === 'No expiry date recorded');
  // "Still OK & Next" is only offered when nothing needs to change: the saved
  // expiry date is present and not expired/flagged, AND (for counted items) the
  // last saved quantity already meets the required minimum.
  const quantityQuickOk =
    item.measurement_type !== 'quantity' ||
    (previousQty != null && (item.required_quantity == null || previousQty >= item.required_quantity));
  const expiryQuickOk = !item.has_expiry || (hasSavedDate && !savedExpired && !savedNeedsAttention);
  const quickEligible = quantityQuickOk && expiryQuickOk;

  const expiryChoice: ExpiryValidationStatus | null =
    value.expiry_validation_status ?? (value.expiry_quick_option === 'no_label' ? 'no_label' : null);

  const hasInput = hasObservation(item, value) || expiryChoice != null || Boolean(value.remarks?.trim());
  const [expanded, setExpanded] = useState(!quickEligible || hasInput);
  // Quantity sub-mode (only for counted items with > 1 required and a previous qty).
  const [qtyMode, setQtyMode] = useState<'same' | 'changed' | null>(
    value.observed_quantity == null
      ? null
      : previousQty != null && value.observed_quantity === previousQty
        ? 'same'
        : 'changed',
  );

  const requiredLabel =
    item.measurement_type === 'quantity'
      ? `Required: ${item.required_quantity ?? '-'} ${item.unit ?? ''}`.trim()
      : item.measurement_type === 'volume_level'
        ? 'Check fill level'
        : 'Check presence / condition';

  const remarksMandatory = remarksRequired(toSpec(item), value, now);

  const previousCondition =
    item.measurement_type === 'quantity'
      ? item.current_quantity != null
        ? `${item.current_quantity} ${item.unit ?? ''}`.trim()
        : null
      : item.measurement_type === 'volume_level'
        ? item.current_volume_level
        : item.current_present_status;

  function stillOk() {
    const patch: Partial<DraftObservation> = { expiry_quick_option: null };
    if (item.measurement_type === 'quantity')
      patch.observed_quantity = item.current_quantity ?? item.required_quantity ?? 1;
    if (item.measurement_type === 'volume_level') patch.observed_volume_level = 'Full';
    if (item.measurement_type === 'present_absent') patch.observed_present_status = 'Present';
    if (item.has_expiry) patch.expiry_validation_status = 'matches_label';
    set(patch);
    onComplete?.();
  }

  function setExpiryChoice(status: ExpiryValidationStatus) {
    const patch: Partial<DraftObservation> = { expiry_validation_status: status, expiry_quick_option: null };
    // Matches-label / no-label keep the saved date; never send a new one.
    if (status === 'matches_label' || status === 'no_label') patch.expiry_date = null;
    if (status === 'different_date') patch.expiry_date = value.expiry_date ?? null;
    if (status === 'replaced_now') {
      patch.expiry_date = value.expiry_date ?? null;
      patch.replacement_date = value.replacement_date ?? todayIso();
      if (item.measurement_type === 'quantity')
        patch.observed_quantity = item.required_quantity ?? value.observed_quantity ?? 1;
      if (item.measurement_type === 'volume_level') patch.observed_volume_level = 'Full';
      if (item.measurement_type === 'present_absent') patch.observed_present_status = 'Present';
    }
    if (status === 'no_label' && !value.remarks?.trim()) patch.remarks = 'Cannot find expiry label.';
    set(patch);
    // "Date matches label" is a terminal one-tap action -> allow auto-advance.
    if (status === 'matches_label') onComplete?.();
  }

  const expiryActions: ExpiryAction[] = !hasSavedDate
    ? [
        { status: 'different_date', label: 'Record expiry date' },
        { status: 'no_label', label: 'Cannot find expiry label' },
        { status: 'replaced_now', label: 'I replaced this item now', full: true },
      ]
    : [
        { status: 'matches_label', label: 'Date matches label' },
        { status: 'different_date', label: 'Label date is different' },
        { status: 'no_label', label: 'Cannot find expiry label' },
        { status: 'replaced_now', label: 'I replaced this item now', full: true },
      ];

  const showDatePicker = expiryChoice === 'different_date' || expiryChoice === 'replaced_now';

  return (
    <div className="card p-3">
      <div className="flex gap-3">
        <ItemPhoto url={item.item_photo_url} name={item.item_name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight">{item.item_name}</h3>
            {live ? <FinalItemStatusBadge status={live.final_item_status} /> : <Badge tone="neutral">Pending</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {requiredLabel}
            {item.is_critical && <span className="ml-2 font-semibold text-red-600">Critical</span>}
          </p>
        </div>
      </div>

      {!expanded && quickEligible ? (
        // Quick confirm - lean default for an item with valid saved data.
        <div className="mt-3 space-y-3">
          {(previousCondition || item.has_expiry) && (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              {previousCondition && (
                <p>
                  <span className="text-slate-500">Previous: </span>
                  <span className="font-semibold">{previousCondition}</span>
                </p>
              )}
              {item.has_expiry && (
                <p>
                  <span className="text-slate-500">Saved expiry date: </span>
                  <span className="font-semibold">{formatDate(item.current_expiry_date)}</span>
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={stillOk}
              className="btn btn-md bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Still OK &amp; Next
            </button>
            <button type="button" onClick={() => setExpanded(true)} className="btn btn-md btn-secondary">
              Issue / Change
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Condition */}
          <div className="mt-3">
            {item.measurement_type === 'quantity' &&
              (item.required_quantity === 1 ? (
                // Single-unit item: present-style Available / Missing, no number pad.
                <div className="flex gap-2">
                  {([
                    { label: 'Available', qty: 1, tone: 'ok' as const },
                    { label: 'Missing', qty: 0, tone: 'bad' as const },
                  ]).map((opt) => {
                    const selected = value.observed_quantity === opt.qty;
                    return (
                      <button
                        type="button"
                        key={opt.label}
                        onClick={() => {
                          set({ observed_quantity: opt.qty });
                          onComplete?.();
                        }}
                        className={`choice ${selected ? toneClass.on[opt.tone] : ''}`}
                        aria-pressed={selected}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    Required: {item.required_quantity ?? '-'} {item.unit ?? ''}
                    {previousQty != null && (
                      <>
                        {' · '}Previous: {previousQty} {item.unit ?? ''}
                      </>
                    )}
                  </p>
                  {previousQty != null && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setQtyMode('same');
                          set({ observed_quantity: previousQty });
                        }}
                        className={`choice ${
                          qtyMode === 'same'
                            ? toneClass.on[previousQty >= (item.required_quantity ?? 0) ? 'ok' : 'warn']
                            : ''
                        }`}
                        aria-pressed={qtyMode === 'same'}
                      >
                        Same as previous ({previousQty})
                      </button>
                      <button
                        type="button"
                        onClick={() => setQtyMode('changed')}
                        className={`choice ${qtyMode === 'changed' ? toneClass.on.warn : ''}`}
                        aria-pressed={qtyMode === 'changed'}
                      >
                        Quantity changed
                      </button>
                    </div>
                  )}
                  {(qtyMode === 'changed' || previousQty == null) && (
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
                </div>
              ))}

            {item.measurement_type === 'volume_level' && (
              <div className="flex flex-wrap gap-2">
                {VOLUME_LEVELS.map((lvl) => {
                  const selected = value.observed_volume_level === lvl;
                  return (
                    <button
                      type="button"
                      key={lvl}
                      onClick={() => {
                        set({ observed_volume_level: lvl });
                        onComplete?.();
                      }}
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
                      onClick={() => {
                        set({ observed_present_status: opt.value });
                        onComplete?.();
                      }}
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

          {/* Expiry - only when the item is expiry-tracked */}
          {item.has_expiry && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="label">{hasSavedDate ? 'Expiry validation' : 'Expiry record'}</span>
                  <p className="text-sm font-semibold">
                    {hasSavedDate
                      ? `Saved expiry date: ${formatDate(item.current_expiry_date)}`
                      : 'No expiry date saved yet.'}
                  </p>
                </div>
                <Badge
                  tone={
                    !hasSavedDate
                      ? 'warn'
                      : item.expiry_status === 'Expired'
                        ? 'bad'
                        : item.expiry_status === 'Valid'
                          ? 'ok'
                          : 'warn'
                  }
                >
                  {!hasSavedDate ? 'Baseline missing' : (item.expiry_status ?? '-')}
                </Badge>
              </div>

              {savedExpired && (
                <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-sm font-semibold text-red-700">
                  Expired - replacement required
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                {expiryActions.map((a) => (
                  <button
                    type="button"
                    key={a.status}
                    onClick={() => setExpiryChoice(a.status)}
                    className={`btn btn-secondary min-h-11 px-3 text-sm ${
                      expiryChoice === a.status ? 'border-brand bg-red-50 text-brand' : ''
                    } ${a.full ? 'col-span-2' : ''}`}
                    aria-pressed={expiryChoice === a.status}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              {showDatePicker && (
                <div className="mt-3 grid gap-3">
                  <label className="block">
                    <span className="label">{expiryChoice === 'replaced_now' ? 'New expiry date' : 'Expiry date'}</span>
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
            </div>
          )}

          {/* Remarks */}
          <label className="mt-3 block">
            <span className="label">
              {remarksMandatory ? 'Remarks (required)' : 'Remarks (optional)'}
              {remarksMandatory && <span className="text-red-600"> *</span>}
            </span>
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
        </>
      )}
    </div>
  );
}
