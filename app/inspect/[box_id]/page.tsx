'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiClientError, type InspectionSubmitBody } from '@/lib/client/api.ts';
import type { InspectionResult, InspectionTemplateResponse, Me } from '@/lib/client/types.ts';
import { clearDraft, loadDraft, saveDraft, type DraftObservation } from '@/lib/client/draft.ts';
import { hasObservation, toSpec } from '@/lib/client/inspect-helpers.ts';
import { validateObservation } from '@/lib/logic/inspection.ts';
import { computeDue } from '@/lib/logic/due.ts';
import { formatDate } from '@/lib/client/format.ts';
import { RequireAuth, AccessBlocked } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { ChecklistCard } from '@/components/ChecklistCard';
import { PhotoCapture } from '@/components/PhotoCapture';
import { Spinner, FullScreenLoader } from '@/components/Spinner';
import { Badge, DueBadge, OverallBadge, PriorityBadge } from '@/components/StatusBadge';

export default function InspectPage() {
  const params = useParams<{ box_id: string }>();
  const boxId = params.box_id;
  return <RequireAuth roles={['admin', 'first_aider']}>{(me) => <Inspect me={me} boxId={boxId} />}</RequireAuth>;
}

type LoadError = { type: 'forbidden' | 'notfound' | 'other'; message: string };
type ValidationIssue = { message: string; itemIndex: number | null };

function Inspect({ me, boxId }: { me: Me; boxId: string }) {
  const now = useMemo(() => new Date(), []);
  const [tpl, setTpl] = useState<InspectionTemplateResponse | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  const [obs, setObs] = useState<Record<string, DraftObservation>>({});
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<{ url: string; publicId: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastEditedItemId, setLastEditedItemId] = useState<string | null>(null);

  // Load checklist + restore any saved draft.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const t = await api.inspectionTemplate(boxId);
        if (!active) return;
        setTpl(t);
        const d = loadDraft(boxId);
        if (d) {
          setObs(d.observations ?? {});
          setNotes(d.notes ?? '');
          if (d.photoUrl && d.photoPublicId) setPhoto({ url: d.photoUrl, publicId: d.photoPublicId });
          setDraftRestored(true);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError) {
          if (err.status === 403) setLoadError({ type: 'forbidden', message: err.message });
          else if (err.status === 404) setLoadError({ type: 'notfound', message: err.message });
          else setLoadError({ type: 'other', message: err.message });
        } else {
          setLoadError({ type: 'other', message: 'Could not load the checklist.' });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [boxId]);

  // Auto-save the draft on every change (offline-resilient).
  useEffect(() => {
    if (!tpl || result) return;
    saveDraft({
      boxId,
      updatedAt: Date.now(),
      notes,
      observations: obs,
      photoUrl: photo?.url ?? null,
      photoPublicId: photo?.publicId ?? null,
    });
  }, [obs, notes, photo, tpl, result, boxId]);

  useEffect(() => {
    if (!tpl) return;
    if (currentIndex >= tpl.items.length) {
      setCurrentIndex(Math.max(0, tpl.items.length - 1));
    }
  }, [tpl, currentIndex]);

  useEffect(() => {
    if (!tpl || !lastEditedItemId) return;
    const item = tpl.items[currentIndex];
    if (!item || item.box_item_id !== lastEditedItemId || currentIndex >= tpl.items.length - 1) return;

    const err = getItemValidationError(item, obs[item.box_item_id] ?? {});
    if (err) return;

    const timer = window.setTimeout(() => {
      setCurrentIndex((idx) => (idx === currentIndex ? Math.min(idx + 1, tpl.items.length - 1) : idx));
      setLastEditedItemId(null);
      setSubmitError(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [tpl, currentIndex, obs, lastEditedItemId]);

  if (loadError?.type === 'forbidden') {
    return <AccessBlocked message="You are not assigned to this first aid box." />;
  }
  if (loadError?.type === 'notfound') {
    return <AccessBlocked message="This first aid box was not found or is inactive." />;
  }
  if (loadError) {
    return <AccessBlocked message={loadError.message} />;
  }
  if (!tpl) return <FullScreenLoader label="Loading checklist…" />;

  // Result screen
  if (result) {
    return <ResultView result={result} tpl={tpl} />;
  }

  function getItemValidationError(
    item: InspectionTemplateResponse['items'][number],
    value: DraftObservation,
  ): string | null {
    if (!hasObservation(item, value)) return `Check ${item.item_name} before continuing.`;
    return validateObservation(toSpec(item), value);
  }

  function findValidationIssue(): ValidationIssue | null {
    for (let i = 0; i < tpl!.items.length; i += 1) {
      const it = tpl!.items[i]!;
      const err = getItemValidationError(it, obs[it.box_item_id] ?? {});
      if (err) return { message: err, itemIndex: i };
    }
    if (!photo) return { message: 'Please take a live photo of the first aid box.', itemIndex: null };
    return null;
  }

  function showValidationIssue(issue: ValidationIssue): void {
    if (issue.itemIndex !== null) setCurrentIndex(issue.itemIndex);
    setLastEditedItemId(null);
    setSubmitError(issue.message);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goToItem(index: number): void {
    setCurrentIndex(Math.min(Math.max(index, 0), tpl!.items.length - 1));
    setLastEditedItemId(null);
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function nextItem(): void {
    goToItem(currentIndex + 1);
  }

  function setCurrentItem(next: DraftObservation): void {
    const item = tpl!.items[currentIndex]!;
    const previous = obs[item.box_item_id] ?? {};
    const changedInspectionValue =
      previous.observed_quantity !== next.observed_quantity ||
      previous.observed_volume_level !== next.observed_volume_level ||
      previous.observed_present_status !== next.observed_present_status ||
      previous.expiry_date !== next.expiry_date;

    setObs((p) => ({ ...p, [item.box_item_id]: next }));
    setLastEditedItemId(changedInspectionValue ? item.box_item_id : null);
    setSubmitError(null);
  }

  async function submit() {
    if (submitting) return;
    const issue = findValidationIssue();
    if (issue) {
      showValidationIssue(issue);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: InspectionSubmitBody = {
        box_id: boxId,
        notes: notes.trim() || null,
        box_photo_url: photo!.url,
        box_photo_cloudinary_public_id: photo!.publicId,
        submitted_device: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : null,
        inspection_items: tpl!.items.map((it) => {
          const o = obs[it.box_item_id] ?? {};
          return {
            box_item_id: it.box_item_id,
            observed_quantity: o.observed_quantity ?? null,
            observed_volume_level: o.observed_volume_level ?? null,
            observed_present_status: o.observed_present_status ?? null,
            expiry_date: o.expiry_date ?? null,
            remarks: o.remarks ?? null,
          };
        }),
      };
      const res = await api.submitInspection(body);
      clearDraft(boxId); // keep the draft only if submit failed
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      const localIssue = findValidationIssue();
      if (localIssue) {
        showValidationIssue(localIssue);
        return;
      }
      setSubmitError(
        e instanceof Error ? e.message : 'Submission failed. Your draft is saved — please retry.',
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  }

  const checkedCount = tpl.items.filter((it) => !getItemValidationError(it, obs[it.box_item_id] ?? {})).length;
  const currentItem = tpl.items[currentIndex] ?? tpl.items[0]!;
  const due = tpl.last_inspection
    ? computeDue({
        lastInspectionAt: tpl.last_inspection.created_at,
        boxCreatedAt: tpl.last_inspection.created_at,
        frequencyDays: tpl.box.inspection_frequency_days,
        now,
      })
    : null;

  return (
    <>
      <AppHeader title={tpl.box.box_name} subtitle={tpl.box.box_code} backHref="/my-boxes" />
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-28">
        {/* Box header */}
        <section className="card p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-500">{tpl.box.box_code}</p>
              <h2 className="text-lg font-bold">{tpl.box.box_name}</h2>
            </div>
            {due ? (
              <DueBadge status={due.due_status} daysOverdue={due.days_overdue} />
            ) : (
              <Badge tone="neutral">Not Yet Inspected</Badge>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Location</dt>
            <dd className="col-span-2">{tpl.box.location_description}</dd>
            {tpl.box.area && (
              <>
                <dt className="text-slate-500">Area</dt>
                <dd className="col-span-2">{tpl.box.area}</dd>
              </>
            )}
            <dt className="text-slate-500">Inspector</dt>
            <dd className="col-span-2">{me.full_name}</dd>
            <dt className="text-slate-500">Last inspection</dt>
            <dd className="col-span-2">{formatDate(tpl.last_inspection?.created_at)}</dd>
          </dl>
          {tpl.template?.guideline_reference && (
            <p className="mt-2 text-xs text-slate-400">{tpl.template.guideline_reference}</p>
          )}
        </section>

        {draftRestored && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>Draft restored from this device.</span>
            <button
              onClick={() => {
                clearDraft(boxId);
                setObs({});
                setNotes('');
                setPhoto(null);
                setCurrentIndex(0);
                setLastEditedItemId(null);
                setDraftRestored(false);
              }}
              className="font-semibold underline"
            >
              Clear draft
            </button>
          </div>
        )}

        {submitError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>
        )}

        <section className="card space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Item {currentIndex + 1} of {tpl.items.length}
              </p>
              <h3 className="truncate text-lg font-bold">{currentItem.item_name}</h3>
            </div>
            <p className="shrink-0 text-sm font-medium text-slate-500">
              {checkedCount}/{tpl.items.length} complete
            </p>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Inspection item navigation">
            {tpl.items.map((it, i) => {
              const complete = !getItemValidationError(it, obs[it.box_item_id] ?? {});
              const active = i === currentIndex;
              return (
                <button
                  key={it.box_item_id}
                  type="button"
                  onClick={() => goToItem(i)}
                  className={`h-9 min-w-9 rounded-full border px-3 text-sm font-semibold ${
                    active
                      ? 'border-brand bg-brand text-white'
                      : complete
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-500'
                  }`}
                  aria-current={active ? 'step' : undefined}
                  aria-label={`Go to item ${i + 1}: ${it.item_name}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </section>

        <ChecklistCard
          item={currentItem}
          value={obs[currentItem.box_item_id] ?? {}}
          onChange={setCurrentItem}
          now={now}
        />

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => goToItem(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="btn btn-lg btn-secondary"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={nextItem}
            disabled={currentIndex >= tpl.items.length - 1}
            className="btn btn-lg btn-primary"
          >
            Next item
          </button>
        </div>

        {/* Box photo */}
        <section className="card p-4">
          <h3 className="mb-2 font-semibold">Live box photo</h3>
          <PhotoCapture
            initialUrl={photo?.url ?? null}
            onChange={(next) => {
              setPhoto(next);
              setSubmitError(null);
            }}
            disabled={submitting}
          />
        </section>

        {/* Notes */}
        <label className="block">
          <span className="label">Overall notes (optional)</span>
          <textarea
            className="textarea"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </main>

      {/* Sticky submit bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <button onClick={submit} disabled={submitting} className="btn btn-lg btn-primary w-full">
            {submitting ? (
              <>
                <Spinner className="h-5 w-5" /> Submitting…
              </>
            ) : (
              'Submit inspection'
            )}
          </button>
        </div>
      </div>
    </>
  );
}

function ResultView({
  result,
  tpl,
}: {
  result: InspectionResult;
  tpl: InspectionTemplateResponse;
}) {
  const s = result.summary;
  return (
    <>
      <AppHeader title="Inspection submitted" subtitle={tpl.box.box_name} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <section className="card flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-5xl">
            {result.overall_status === 'Pass' ? '✅' : result.overall_status === 'Fail' ? '⛔' : '⚠️'}
          </div>
          <OverallBadge status={result.overall_status} />
          <p className="text-sm text-slate-500">
            {s.ok} OK · {s.low_stock} low · {s.missing} missing · {s.expired} expired ·{' '}
            {s.expiring_soon} expiring soon
          </p>
        </section>

        <section className="card p-4">
          <h3 className="mb-2 font-semibold">
            Top-up requested ({result.topups_created})
          </h3>
          {result.topup_items.length === 0 ? (
            <p className="text-sm text-slate-500">No items need a top-up. 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {result.topup_items.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{t.item_name}</p>
                    <p className="text-xs text-slate-500">{t.reason}</p>
                  </div>
                  <PriorityBadge priority={t.priority} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid grid-cols-2 gap-3">
          <a href="/my-boxes" className="btn btn-lg btn-secondary">
            My boxes
          </a>
          <a href={`/inspect/${tpl.box.box_id}`} className="btn btn-lg btn-primary" onClick={() => location.reload()}>
            Done
          </a>
        </div>
      </main>
    </>
  );
}
