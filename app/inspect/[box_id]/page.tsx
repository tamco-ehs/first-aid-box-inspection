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

  const setItem = (id: string, next: DraftObservation) => setObs((p) => ({ ...p, [id]: next }));

  function markAllRemainingOk() {
    setObs((prev) => {
      const next = { ...prev };
      for (const it of tpl!.items) {
        if (hasObservation(it, next[it.box_item_id])) continue;
        const base = next[it.box_item_id] ?? {};
        if (it.measurement_type === 'quantity') {
          next[it.box_item_id] = { ...base, observed_quantity: it.required_quantity ?? 0 };
        } else if (it.measurement_type === 'volume_level') {
          next[it.box_item_id] = { ...base, observed_volume_level: 'Full' };
        } else {
          next[it.box_item_id] = { ...base, observed_present_status: 'Present' };
        }
      }
      return next;
    });
  }

  function validate(): string | null {
    if (!photo) return 'Please take a live photo of the first aid box.';
    const missing: string[] = [];
    for (const it of tpl!.items) {
      const o = obs[it.box_item_id] ?? {};
      if (!hasObservation(it, o)) {
        missing.push(it.item_name);
        continue;
      }
      const err = validateObservation(toSpec(it), o);
      if (err) return err;
    }
    if (missing.length > 0) {
      return `${missing.length} item(s) still need to be checked (e.g. ${missing[0]}). Use "Mark remaining as OK" if they are fine.`;
    }
    return null;
  }

  async function submit() {
    if (submitting) return;
    const err = validate();
    if (err) {
      setSubmitError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      setSubmitError(
        e instanceof Error ? e.message : 'Submission failed. Your draft is saved — please retry.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const checkedCount = tpl.items.filter((it) => hasObservation(it, obs[it.box_item_id])).length;
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

        {/* Progress + bulk action */}
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-slate-500">
            {checkedCount}/{tpl.items.length} items checked
          </p>
          <button onClick={markAllRemainingOk} className="btn btn-secondary btn-md">
            Mark remaining as OK
          </button>
        </div>

        {/* Checklist (rendered from the database template) */}
        <div className="space-y-3">
          {tpl.items.map((it) => (
            <ChecklistCard
              key={it.box_item_id}
              item={it}
              value={obs[it.box_item_id] ?? {}}
              onChange={(next) => setItem(it.box_item_id, next)}
              now={now}
            />
          ))}
        </div>

        {/* Box photo */}
        <section className="card p-4">
          <h3 className="mb-2 font-semibold">Live box photo</h3>
          <PhotoCapture initialUrl={photo?.url ?? null} onChange={setPhoto} disabled={submitting} />
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
