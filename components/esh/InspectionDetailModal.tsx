'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api.ts';
import type { InspectionDetail, ItemCheckStatus } from '@/lib/client/types.ts';
import { formatDate, formatDateTime } from '@/lib/client/format.ts';
import { Spinner } from '@/components/Spinner';
import {
  ActionStatusBadge,
  Badge,
  ItemCheckBadge,
  PriorityBadge,
  ReadinessBadge,
} from '@/components/StatusBadge';

const ITEM_STATUSES: ItemCheckStatus[] = ['OK', 'Low Qty', 'Missing', 'Expired'];

/**
 * Full record of one inspection, opened by clicking a row in the Inspections
 * report. Shows the 4 quick-check answers, every item the first aider checked,
 * the live box photo, notes and the actions that inspection raised.
 */
export function InspectionDetailModal({
  inspectionId,
  onClose,
}: {
  inspectionId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inspectionId) return;
    let active = true;
    setDetail(null);
    setError(null);
    api
      .inspection(inspectionId)
      .then((d) => active && setDetail(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Could not load the inspection.'));
    return () => {
      active = false;
    };
  }, [inspectionId]);

  // Close on Escape.
  useEffect(() => {
    if (!inspectionId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspectionId, onClose]);

  if (!inspectionId) return null;

  const i = detail?.inspection;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Inspection detail"
    >
      <div
        className="my-6 w-full max-w-2xl rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">
              {detail?.box?.box_code ?? 'Inspection'} {detail?.box?.box_name ? `· ${detail.box.box_name}` : ''}
            </h2>
            {detail && (
              <p className="text-sm text-slate-500">
                {formatDateTime(i!.created_at)} · {i!.inspector_name}
                {i!.inspector_department ? ` (${i!.inspector_department})` : ''}
              </p>
            )}
            {detail?.box && (
              <p className="text-xs text-slate-400">
                {[detail.box.location_description, detail.box.area].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn btn-md btn-secondary shrink-0" aria-label="Close">
            Close
          </button>
        </div>

        <div className="space-y-5 p-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          )}
          {!detail && !error && (
            <div className="flex justify-center py-10 text-slate-400">
              <Spinner className="h-7 w-7" />
            </div>
          )}

          {detail && i && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <ReadinessBadge status={i.overall_status} />
                {i.item_check_performed ? (
                  <Badge tone="neutral">Item check done</Badge>
                ) : (
                  <Badge tone="neutral">Quick check only</Badge>
                )}
              </div>

              {/* Quick check answers */}
              <section>
                <h3 className="mb-2 font-semibold">Quick inspection</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Answer label="Box accessible?" value={i.box_accessible} />
                  <Answer label="Box clean and not damaged?" value={i.box_clean} />
                  <Answer label="Seal intact / no sign of use?" value={i.seal_intact} />
                  <Answer label="Emergency contact visible?" value={i.contact_visible} />
                </div>
              </section>

              {/* Item check */}
              <section>
                <h3 className="mb-2 font-semibold">
                  Item check {detail.items.length > 0 && `(${detail.items.length} items)`}
                </h3>
                {detail.items.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    No item check was required — the box was sealed with nothing expired.
                  </p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-2 text-xs">
                      {ITEM_STATUSES.map((s) => {
                        const n = detail.items.filter((it) => it.item_status === s).length;
                        return n > 0 ? (
                          <span key={s}>
                            <ItemCheckBadge status={s} /> <span className="text-slate-500">×{n}</span>
                          </span>
                        ) : null;
                      })}
                    </div>
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {detail.items.map((it) => (
                        <div key={it.id} className="flex items-start justify-between gap-3 p-3">
                          <div className="min-w-0">
                            <p className="font-medium">{it.item_name}</p>
                            <p className="text-xs text-slate-500">
                              Required {it.required_quantity ?? '—'} · Found {it.observed_quantity ?? '—'}
                              {it.expiry_date ? ` · Expiry ${formatDate(it.expiry_date)}` : ''}
                            </p>
                            {it.remarks && <p className="mt-1 text-sm text-slate-600">“{it.remarks}”</p>}
                          </div>
                          {isItemStatus(it.item_status) ? (
                            <ItemCheckBadge status={it.item_status} />
                          ) : (
                            it.item_status && <Badge tone="neutral">{it.item_status}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              {/* Actions raised */}
              <section>
                <h3 className="mb-2 font-semibold">Actions raised ({detail.actions.length})</h3>
                {detail.actions.length === 0 ? (
                  <p className="text-sm text-slate-500">No issues were raised by this inspection.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {detail.actions.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {a.action_type}
                            {a.item_name ? `: ${a.item_name}` : ''}
                          </p>
                          <p className="text-xs text-slate-500">{a.action_code}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {a.priority && <PriorityBadge priority={a.priority} />}
                          <ActionStatusBadge status={a.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Notes + photo */}
              {i.notes && (
                <section>
                  <h3 className="mb-1 font-semibold">Notes</h3>
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{i.notes}</p>
                </section>
              )}

              {i.box_photo_url && (
                <section>
                  <h3 className="mb-2 font-semibold">Box photo</h3>
                  <a href={i.box_photo_url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={i.box_photo_url}
                      alt="First aid box at inspection"
                      className="max-h-80 w-full rounded-xl border border-slate-200 object-contain"
                    />
                  </a>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function isItemStatus(v: string | null): v is ItemCheckStatus {
  return v === 'OK' || v === 'Low Qty' || v === 'Missing' || v === 'Expired';
}

function Answer({ label, value }: { label: string; value: boolean | null }) {
  const good = value === true;
  const unknown = value === null || value === undefined;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-sm">{label}</span>
      {unknown ? (
        <Badge tone="neutral">Not recorded</Badge>
      ) : (
        <Badge tone={good ? 'ok' : 'bad'}>{good ? 'Yes' : 'No'}</Badge>
      )}
    </div>
  );
}
