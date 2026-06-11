'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiClientError, type InspectionSubmitBody } from '@/lib/client/api.ts';
import type {
  FinalItemStatus,
  InspectionResult,
  InspectionTemplateResponse,
  Me,
  TemplateItem,
} from '@/lib/client/types.ts';
import { clearDraft, loadDraft, saveDraft, type DraftObservation } from '@/lib/client/draft.ts';
import { hasObservation, toSpec } from '@/lib/client/inspect-helpers.ts';
import { evaluateItem, validateObservation } from '@/lib/logic/inspection.ts';
import { computeDue } from '@/lib/logic/due.ts';
import { formatDate } from '@/lib/client/format.ts';
import { RequireAuth, AccessBlocked } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { ChecklistCard } from '@/components/ChecklistCard';
import { CompanyLogo } from '@/components/CompanyLogo';
import { PhotoCapture } from '@/components/PhotoCapture';
import { Spinner, FullScreenLoader } from '@/components/Spinner';
import { Badge, DueBadge, OverallBadge, PriorityBadge } from '@/components/StatusBadge';

export default function InspectPage() {
  const params = useParams<{ box_id: string }>();
  const boxId = params.box_id;
  return <RequireAuth roles={['admin', 'first_aider']}>{(me) => <Inspect me={me} boxId={boxId} />}</RequireAuth>;
}

type LoadError = { type: 'forbidden' | 'notfound' | 'other'; message: string };
type InspectionPhase = 'confirm' | 'items' | 'review';
type ActiveSheet = 'details' | 'items' | null;
type StepDirection = 'forward' | 'backward';
type FlowStatus = 'Pending' | 'Completed' | 'Issue found';
type ValidationIssue = { message: string; itemIndex: number | null };

interface ItemReview {
  status: FlowStatus;
  final: FinalItemStatus;
  label: string;
  detail: string | null;
  tone: 'neutral' | 'ok' | 'warn';
  topupRequired: boolean;
  expired: boolean;
  expiringSoon: boolean;
  noExpiryDateRecorded: boolean;
  expiryLabelMismatch: boolean;
  missing: boolean;
  hasRemarks: boolean;
}

function Inspect({ me, boxId }: { me: Me; boxId: string }) {
  const now = useMemo(() => new Date(), []);
  const [tpl, setTpl] = useState<InspectionTemplateResponse | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  const [phase, setPhase] = useState<InspectionPhase>('confirm');
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [obs, setObs] = useState<Record<string, DraftObservation>>({});
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<{ url: string; publicId: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastEditedItemId, setLastEditedItemId] = useState<string | null>(null);
  const [stepDirection, setStepDirection] = useState<StepDirection>('forward');

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
    if (currentIndex >= tpl.items.length) setCurrentIndex(Math.max(0, tpl.items.length - 1));
  }, [tpl, currentIndex]);

  useEffect(() => {
    if (!tpl || !lastEditedItemId || phase !== 'items') return;
    const item = tpl.items[currentIndex];
    if (!item || item.box_item_id !== lastEditedItemId || currentIndex >= tpl.items.length - 1) return;
    if (getItemValidationError(item, obs[item.box_item_id] ?? {})) return;

    const timer = window.setTimeout(() => {
      setStepDirection('forward');
      setCurrentIndex((idx) => (idx === currentIndex ? Math.min(idx + 1, tpl.items.length - 1) : idx));
      setLastEditedItemId(null);
      setSubmitError(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [tpl, phase, currentIndex, obs, lastEditedItemId]);

  if (loadError?.type === 'forbidden') {
    return <AccessBlocked message="You are not assigned to this first aid box." />;
  }
  if (loadError?.type === 'notfound') {
    return <AccessBlocked message="This first aid box was not found or is inactive." />;
  }
  if (loadError) {
    return <AccessBlocked message={loadError.message} />;
  }
  if (!tpl) return <FullScreenLoader label="Loading checklist..." />;

  if (result) {
    return <ResultView result={result} tpl={tpl} />;
  }

  function getBaseValidationError(item: TemplateItem, value: DraftObservation): string | null {
    if (!hasObservation(item, value)) return `Check ${item.item_name} before continuing.`;
    return validateObservation(toSpec(item), value);
  }

  function getItemReview(item: TemplateItem, value: DraftObservation): ItemReview {
    const hasRemarks = Boolean(value.remarks?.trim());
    if (!hasObservation(item, value)) {
      return {
        status: 'Pending',
        final: 'pending',
        label: 'Pending',
        detail: null,
        tone: 'neutral',
        topupRequired: false,
        expired: false,
        expiringSoon: false,
        noExpiryDateRecorded: false,
        expiryLabelMismatch: false,
        missing: false,
        hasRemarks,
      };
    }

    const evaluated = evaluateItem(toSpec(item), value, now);
    const final = evaluated.final_item_status;
    const issue = final === 'issue_found' || final === 'replacement_required' || final === 'topup_required';
    const status: FlowStatus = issue ? 'Issue found' : final === 'ok' ? 'Completed' : 'Pending';
    const detail = final === 'incomplete' ? 'Needs expiry check' : issue ? evaluated.item_status : null;

    return {
      status,
      final,
      label: status,
      detail,
      tone: issue ? 'warn' : final === 'ok' ? 'ok' : 'neutral',
      topupRequired: evaluated.topup_required,
      expired: evaluated.is_expired,
      expiringSoon: evaluated.expires_soon,
      noExpiryDateRecorded: evaluated.no_expiry_date_recorded,
      expiryLabelMismatch: evaluated.expiry_label_mismatch,
      missing: evaluated.item_status === 'Missing',
      hasRemarks,
    };
  }

  function getItemValidationError(item: TemplateItem, value: DraftObservation): string | null {
    // validateObservation (inside getBaseValidationError) is authoritative for
    // required fields AND required remarks, so no extra check is needed here.
    return getBaseValidationError(item, value);
  }

  function findItemValidationIssue(): ValidationIssue | null {
    for (let i = 0; i < tpl!.items.length; i += 1) {
      const it = tpl!.items[i]!;
      const err = getItemValidationError(it, obs[it.box_item_id] ?? {});
      if (err) return { message: err, itemIndex: i };
    }
    return null;
  }

  function findSubmissionValidationIssue(): ValidationIssue | null {
    const itemIssue = findItemValidationIssue();
    if (itemIssue) return itemIssue;
    if (!photo) return { message: 'Please take a live photo of the first aid box.', itemIndex: null };
    return null;
  }

  function showValidationIssue(issue: ValidationIssue): void {
    if (issue.itemIndex !== null) {
      setPhase('items');
      setStepDirection(issue.itemIndex >= currentIndex ? 'forward' : 'backward');
      setCurrentIndex(issue.itemIndex);
    } else {
      setPhase('review');
    }
    setActiveSheet(null);
    setLastEditedItemId(null);
    setSubmitError(issue.message);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearCurrentDraft(): void {
    clearDraft(boxId);
    setObs({});
    setNotes('');
    setPhoto(null);
    setCurrentIndex(0);
    setLastEditedItemId(null);
    setStepDirection('forward');
    setDraftRestored(false);
    setSubmitError(null);
  }

  function startInspection(): void {
    setPhase('items');
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goToItem(index: number): void {
    const nextIndex = Math.min(Math.max(index, 0), tpl!.items.length - 1);
    setPhase('items');
    if (nextIndex !== currentIndex) {
      setStepDirection(nextIndex > currentIndex ? 'forward' : 'backward');
      setCurrentIndex(nextIndex);
    }
    setLastEditedItemId(null);
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openReview(): void {
    const issue = findItemValidationIssue();
    if (issue) {
      showValidationIssue(issue);
      return;
    }
    setPhase('review');
    setActiveSheet(null);
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function nextItem(): void {
    const item = tpl!.items[currentIndex]!;
    const err = getItemValidationError(item, obs[item.box_item_id] ?? {});
    if (err) {
      showValidationIssue({ message: err, itemIndex: currentIndex });
      return;
    }
    if (currentIndex >= tpl!.items.length - 1) {
      openReview();
      return;
    }
    goToItem(currentIndex + 1);
  }

  // Passive value edits (typing a quantity/date, remarks, or picking an expiry
  // option that needs a follow-up date) update the draft but must NOT auto-
  // advance - that made the date field jump straight to the next item. Advancing
  // is requested explicitly via completeCurrentItem (a decisive "tap and move on").
  function setCurrentItem(next: DraftObservation): void {
    const item = tpl!.items[currentIndex]!;
    setObs((p) => ({ ...p, [item.box_item_id]: next }));
    setLastEditedItemId(null);
    setSubmitError(null);
  }

  function completeCurrentItem(): void {
    const item = tpl!.items[currentIndex]!;
    setLastEditedItemId(item.box_item_id);
  }

  async function submit() {
    if (submitting) return;
    const issue = findSubmissionValidationIssue();
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
            expiry_validation_status:
              o.expiry_validation_status ??
              (o.expiry_quick_option === 'no_label'
                ? 'no_label'
                : o.expiry_quick_option === 'expired'
                  ? 'expired'
                  : null),
            replacement_date: o.replacement_date ?? null,
            replacement_photo_url: o.replacement_photo_url ?? null,
            replacement_photo_cloudinary_public_id: o.replacement_photo_cloudinary_public_id ?? null,
            remarks: o.remarks ?? null,
          };
        }),
      };
      const res = await api.submitInspection(body);
      clearDraft(boxId);
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      const localIssue = findSubmissionValidationIssue();
      if (localIssue) {
        showValidationIssue(localIssue);
        return;
      }
      setSubmitError(e instanceof Error ? e.message : 'Submission failed. Your draft is saved - please retry.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  }

  const itemReviews = tpl.items.map((it) => getItemReview(it, obs[it.box_item_id] ?? {}));
  const itemValidationErrors = tpl.items.map((it) => getItemValidationError(it, obs[it.box_item_id] ?? {}));
  const completedCount = itemReviews.filter((r) => r.status === 'Completed').length;
  const issueCount = itemReviews.filter((r) => r.status === 'Issue found').length;
  const checkedCount = completedCount + issueCount;
  const pendingCount = itemReviews.filter((r) => r.status === 'Pending').length;
  const topupCount = itemReviews.filter((r) => r.topupRequired).length;
  const expiredCount = itemReviews.filter((r) => r.expired).length;
  const expiringSoonCount = itemReviews.filter((r) => r.expiringSoon).length;
  const noExpiryDateCount = itemReviews.filter((r) => r.noExpiryDateRecorded).length;
  const expiryMismatchCount = itemReviews.filter((r) => r.expiryLabelMismatch).length;
  const missingCount = itemReviews.filter((r) => r.missing).length;
  const remarksOrIssueCount = tpl.items.filter((it, i) => itemReviews[i]!.status === 'Issue found' || obs[it.box_item_id]?.remarks?.trim()).length;
  const progressPercent = Math.round((checkedCount / Math.max(1, tpl.items.length)) * 100);
  const currentItem = tpl.items[currentIndex] ?? tpl.items[0]!;
  const shortLocation = tpl.box.area || tpl.box.box_name;
  const guidanceNote =
    tpl.template?.guideline_reference ||
    tpl.template?.description ||
    'Confirm this is the correct first aid box before starting the inspection.';
  const due = tpl.last_inspection
    ? computeDue({
        lastInspectionAt: tpl.last_inspection.created_at,
        boxCreatedAt: tpl.last_inspection.created_at,
        frequencyDays: tpl.box.inspection_frequency_days,
        now,
      })
    : null;

  const draftBanner = draftRestored ? (
    <div className="flex items-center justify-between gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
      <span>Draft restored</span>
      <div className="flex items-center gap-3 font-semibold">
        <button type="button" onClick={() => setDraftRestored(false)} className="text-amber-700">
          Dismiss
        </button>
        <button type="button" onClick={clearCurrentDraft} className="text-red-600">
          Clear
        </button>
      </div>
    </div>
  ) : null;

  if (phase === 'confirm') {
    return (
      <>
        <AppHeader title="Confirm box" subtitle={tpl.box.box_code} backHref="/my-boxes" />
        <main className="mx-auto max-w-md space-y-3 p-4">
          {draftBanner}
          <section className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-500">{tpl.box.box_code}</p>
                <h1 className="text-xl font-bold">{tpl.box.box_name}</h1>
              </div>
              {due ? <DueBadge status={due.due_status} daysOverdue={due.days_overdue} /> : <Badge tone="neutral">Not Yet Inspected</Badge>}
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-slate-500">Location</dt>
              <dd className="col-span-2 font-medium">{tpl.box.location_description}</dd>
              {tpl.box.area && (
                <>
                  <dt className="text-slate-500">Area</dt>
                  <dd className="col-span-2 font-medium">{tpl.box.area}</dd>
                </>
              )}
              <dt className="text-slate-500">Inspector</dt>
              <dd className="col-span-2 font-medium">{me.full_name}</dd>
              <dt className="text-slate-500">Last check</dt>
              <dd className="col-span-2 font-medium">{formatDate(tpl.last_inspection?.created_at)}</dd>
            </dl>
            <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{guidanceNote}</p>
          </section>
          <button type="button" onClick={startInspection} className="btn btn-lg btn-primary w-full">
            Start Inspection
          </button>
        </main>
      </>
    );
  }

  if (phase === 'review') {
    return (
      <>
        <AppHeader title="Final review" subtitle={tpl.box.box_code} backHref="/my-boxes" />
        <main className="mx-auto max-w-md space-y-3 p-4 pb-28">
          {draftBanner}
          {submitError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>}
          <section className="card p-4">
            <h1 className="text-xl font-bold">Inspection summary</h1>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <SummaryTile label="Total items" value={tpl.items.length} />
              <SummaryTile label="Completed" value={completedCount} />
              <SummaryTile label="Top-up" value={topupCount} tone="warn" />
              <SummaryTile label="Expired" value={expiredCount} tone="bad" />
              <SummaryTile label="Missing" value={missingCount} tone="bad" />
              <SummaryTile label="Remarks/issues" value={remarksOrIssueCount} tone="warn" />
            </div>
            {(expiredCount > 0 || expiringSoonCount > 0 || expiryMismatchCount > 0 || noExpiryDateCount > 0) && (
              <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">Expiry issues</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {expiredCount > 0 && <li>{expiredCount} item{expiredCount === 1 ? '' : 's'} expired</li>}
                  {expiringSoonCount > 0 && (
                    <li>{expiringSoonCount} item{expiringSoonCount === 1 ? '' : 's'} expiring soon</li>
                  )}
                  {expiryMismatchCount > 0 && (
                    <li>{expiryMismatchCount} item{expiryMismatchCount === 1 ? '' : 's'} with label mismatch/no label</li>
                  )}
                  {noExpiryDateCount > 0 && (
                    <li>{noExpiryDateCount} item{noExpiryDateCount === 1 ? '' : 's'} with no expiry date recorded</li>
                  )}
                </ul>
              </div>
            )}
            <button type="button" onClick={() => goToItem(0)} className="btn btn-md btn-secondary mt-4 w-full">
              Back to items
            </button>
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Live box photo</h2>
            <PhotoCapture
              initialUrl={photo?.url ?? null}
              onChange={(next) => {
                setPhoto(next);
                setSubmitError(null);
              }}
              disabled={submitting}
            />
          </section>

          <label className="block">
            <span className="label">Overall notes (optional)</span>
            <textarea className="textarea" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </main>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-md">
            <button type="button" onClick={submit} disabled={submitting} className="btn btn-lg btn-primary w-full">
              {submitting ? (
                <>
                  <Spinner className="h-5 w-5" /> Submitting...
                </>
              ) : (
                'Submit Inspection'
              )}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-3 py-2">
          <CompanyLogo className="h-6 w-auto max-w-[82px] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{tpl.box.box_code}</p>
            <p className="truncate text-xs text-slate-500">{shortLocation}</p>
          </div>
          <div className="text-right text-xs font-semibold text-slate-600">
            Item {currentIndex + 1} of {tpl.items.length}
          </div>
          <button type="button" onClick={() => setActiveSheet('details')} className="btn btn-ghost min-h-9 px-2 text-xs">
            Details
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-3 p-3 pb-28">
        {draftBanner}
        {submitError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>}

        <section className="card p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                Item {currentIndex + 1} of {tpl.items.length}
              </p>
              <p className="text-xs text-slate-500">
                {checkedCount} checked - {pendingCount} pending
              </p>
            </div>
            <button type="button" onClick={() => setActiveSheet('items')} className="btn btn-md btn-secondary">
              View All Items
            </button>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="mt-3 flex gap-1 overflow-hidden" aria-hidden>
            {itemReviews.map((review, i) => (
              <span
                key={tpl.items[i]!.box_item_id}
                className={`h-2 flex-1 rounded-full ${
                  i === currentIndex
                    ? 'bg-brand'
                    : review.status === 'Issue found'
                        ? 'bg-amber-400'
                        : review.status === 'Completed'
                          ? 'bg-emerald-400'
                          : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </section>

        <div
          key={currentItem.box_item_id}
          className={`inspection-step ${stepDirection === 'backward' ? 'inspection-step-backward' : 'inspection-step-forward'}`}
        >
          <ChecklistCard
            item={currentItem}
            value={obs[currentItem.box_item_id] ?? {}}
            onChange={setCurrentItem}
            onComplete={completeCurrentItem}
            now={now}
          />
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
          <button type="button" onClick={() => goToItem(currentIndex - 1)} disabled={currentIndex === 0} className="btn btn-lg btn-secondary">
            Previous
          </button>
          <button type="button" onClick={nextItem} className="btn btn-lg btn-primary">
            {currentIndex >= tpl.items.length - 1 ? 'Review' : 'Next item'}
          </button>
        </div>
      </div>

      {activeSheet === 'details' && (
        <BottomSheet title="Box details" onClose={() => setActiveSheet(null)}>
          <BoxDetails tpl={tpl} me={me} guidanceNote={guidanceNote} />
        </BottomSheet>
      )}

      {activeSheet === 'items' && (
        <BottomSheet title="Checklist items" onClose={() => setActiveSheet(null)}>
          <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
            {tpl.items.map((item, i) => (
              <button
                key={item.box_item_id}
                type="button"
                onClick={() => {
                  setActiveSheet(null);
                  goToItem(i);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {i + 1}. {item.item_name}
                  </span>
                  {itemReviews[i]!.detail && <span className="block text-xs text-slate-500">{itemReviews[i]!.detail}</span>}
                </span>
                <StatusChip review={itemReviews[i]!} incomplete={Boolean(itemValidationErrors[i])} />
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
    </>
  );
}

function BoxDetails({
  tpl,
  me,
  guidanceNote,
}: {
  tpl: InspectionTemplateResponse;
  me: Me;
  guidanceNote: string;
}) {
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-3 gap-y-2">
        <dt className="text-slate-500">Box code</dt>
        <dd className="col-span-2 font-medium">{tpl.box.box_code}</dd>
        <dt className="text-slate-500">Box name</dt>
        <dd className="col-span-2 font-medium">{tpl.box.box_name}</dd>
        <dt className="text-slate-500">Location</dt>
        <dd className="col-span-2 font-medium">{tpl.box.location_description}</dd>
        {tpl.box.area && (
          <>
            <dt className="text-slate-500">Area</dt>
            <dd className="col-span-2 font-medium">{tpl.box.area}</dd>
          </>
        )}
        <dt className="text-slate-500">Inspector</dt>
        <dd className="col-span-2 font-medium">{me.full_name}</dd>
        <dt className="text-slate-500">Last check</dt>
        <dd className="col-span-2 font-medium">{formatDate(tpl.last_inspection?.created_at)}</dd>
      </dl>
      <p className="rounded-xl bg-slate-50 px-3 py-2 text-slate-600">{guidanceNote}</p>
    </div>
  );
}

function StatusChip({ review, incomplete }: { review: ItemReview; incomplete: boolean }) {
  const label = incomplete && review.status !== 'Pending' ? `${review.label} - needs info` : review.label;
  const cls =
    review.status === 'Issue found'
      ? 'bg-amber-100 text-amber-900'
      : incomplete || review.status === 'Pending'
        ? 'bg-slate-200 text-slate-700'
        : 'bg-emerald-100 text-emerald-800';
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

function SummaryTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warn' | 'bad';
}) {
  const cls =
    tone === 'bad'
      ? 'bg-red-50 text-red-800'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-900'
        : 'bg-slate-50 text-slate-800';
  return (
    <div className={`rounded-xl px-3 py-2 ${cls}`}>
      <p className="text-xs font-medium opacity-75">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="Close" />
      <section className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost min-h-10 px-3">
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
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
          <OverallBadge status={result.overall_status} />
          <p className="text-sm text-slate-500">
            {s.ok} OK - {s.low_stock} low - {s.missing} missing - {s.expired} expired - {s.expiring_soon} expiring soon
          </p>
        </section>

        <section className="card p-4">
          <h3 className="mb-2 font-semibold">Top-up requested ({result.topups_created})</h3>
          {result.topup_items.length === 0 ? (
            <p className="text-sm text-slate-500">No items need a top-up.</p>
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
