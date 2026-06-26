'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiClientError, type QuickInspectionBody } from '@/lib/client/api.ts';
import type { InspectionTemplateResponse, Me, QuickInspectionResult } from '@/lib/client/types.ts';
import {
  clearDraft,
  emptyDraft,
  type ItemDraft,
  type QuickDraft,
} from '@/lib/client/draft.ts';
import { itemCheckRequired } from '@/lib/logic/actions.ts';
import { formatDate, todayIso } from '@/lib/client/format.ts';
import { RequireAuth, AccessBlocked } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { YesNo } from '@/components/YesNo';
import { ItemCheckCard } from '@/components/ItemCheckCard';
import { PhotoCapture } from '@/components/PhotoCapture';
import { Spinner, FullScreenLoader } from '@/components/Spinner';
import { Badge, PriorityBadge, ReadinessBadge } from '@/components/StatusBadge';

const QUESTIONS = [
  { key: 'box_accessible', label: 'Box accessible?' },
  { key: 'box_clean', label: 'Box clean and not damaged?' },
  { key: 'seal_intact', label: 'Seal intact / no sign of use?' },
  { key: 'contact_visible', label: 'Emergency contact visible?' },
] as const;

export default function InspectPage() {
  const params = useParams<{ box_id: string }>();
  return (
    <RequireAuth roles={['admin', 'first_aider']}>
      {(me) => <Inspect me={me} boxId={params.box_id} />}
    </RequireAuth>
  );
}

type Step = 'form' | 'review';
type LoadErr = { type: 'forbidden' | 'notfound' | 'other'; message: string };

function Inspect({ me, boxId }: { me: Me; boxId: string }) {
  const [tpl, setTpl] = useState<InspectionTemplateResponse | null>(null);
  const [loadErr, setLoadErr] = useState<LoadErr | null>(null);
  const [draft, setDraft] = useState<QuickDraft>(() => emptyDraft(boxId));
  const [step, setStep] = useState<Step>('form');
  const [photo, setPhoto] = useState<{ url: string; publicId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickInspectionResult | null>(null);

  useEffect(() => {
    let active = true;
    clearDraft(boxId);
    setDraft(emptyDraft(boxId));
    setStep('form');
    setPhoto(null);
    setSubmitError(null);
    setResult(null);
    (async () => {
      try {
        const t = await api.inspectionTemplate(boxId);
        if (!active) return;
        setTpl(t);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError) {
          if (err.status === 403) setLoadErr({ type: 'forbidden', message: err.message });
          else if (err.status === 404) setLoadErr({ type: 'notfound', message: err.message });
          else setLoadErr({ type: 'other', message: err.message });
        } else setLoadErr({ type: 'other', message: 'Could not load the box.' });
      }
    })();
    return () => {
      active = false;
    };
  }, [boxId]);

  const today = todayIso();
  const hasKnownExpired = useMemo(
    () =>
      (tpl?.items ?? []).some(
        (i) => i.has_expiry && i.current_expiry_date != null && i.current_expiry_date < today,
      ),
    [tpl, today],
  );

  if (loadErr?.type === 'forbidden')
    return <AccessBlocked message="You are not assigned to this first aid box." />;
  if (loadErr?.type === 'notfound')
    return <AccessBlocked message="This first aid box was not found or is inactive." />;
  if (loadErr) return <AccessBlocked message={loadErr.message} />;
  if (!tpl) return <FullScreenLoader label="Loading box…" />;
  if (result) return <ResultView result={result} tpl={tpl} />;

  const a = draft.answers;
  const allAnswered = QUESTIONS.every((q) => a[q.key] !== null);
  // Item checklist opens only when the seal is broken or an item is expired.
  const needItems = itemCheckRequired(a.seal_intact !== false, hasKnownExpired);

  const setAnswer = (key: (typeof QUESTIONS)[number]['key'], v: boolean) =>
    setDraft((d) => ({ ...d, answers: { ...d.answers, [key]: v } }));
  const setItem = (id: string, next: ItemDraft) =>
    setDraft((d) => ({ ...d, items: { ...d.items, [id]: next } }));

  function markRemainingOk() {
    setDraft((d) => {
      const items = { ...d.items };
      for (const it of tpl!.items) {
        if (!items[it.box_item_id]?.status) items[it.box_item_id] = { ...items[it.box_item_id], status: 'OK' };
      }
      return { ...d, items };
    });
  }

  function validate(): string | null {
    if (!allAnswered) return 'Please answer all 4 questions.';
    if (needItems) {
      for (const it of tpl!.items) {
        const v = draft.items[it.box_item_id];
        if (!v?.status) return `Please check every item (e.g. ${it.item_name}).`;
        if (v.status === 'Expired' && !it.has_expiry)
          return `"${it.item_name}": only items marked as expirable in the master list can be marked Expired.`;
        if (v.status === 'Low Qty' && v.observed_quantity == null)
          return `"${it.item_name}": enter current quantity.`;
      }
    }
    return null;
  }

  function goReview() {
    const err = validate();
    if (err) {
      setSubmitError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitError(null);
    setStep('review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const item_check = needItems
        ? tpl!.items.map((it) => {
            const v = draft.items[it.box_item_id]!;
            return {
              box_item_id: it.box_item_id,
              status: v.status!,
              observed_quantity: v.status === 'Missing' ? 0 : v.status === 'Low Qty' ? v.observed_quantity ?? null : null,
              new_expiry_date: null,
              remark: v.status === 'Expired' ? null : v.remark ?? null,
            };
          })
        : undefined;
      const body: QuickInspectionBody = {
        box_id: boxId,
        box_accessible: a.box_accessible!,
        box_clean: a.box_clean!,
        seal_intact: a.seal_intact!,
        contact_visible: a.contact_visible!,
        notes: draft.notes.trim() || null,
        box_photo_url: photo?.url ?? null,
        box_photo_cloudinary_public_id: photo?.publicId ?? null,
        submitted_device: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : null,
        item_check,
      };
      const res = await api.submitInspection(body);
      clearDraft(boxId);
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed. Please retry before leaving this page.');
      setStep('form');
    } finally {
      setSubmitting(false);
    }
  }

  // counts for the review summary
  const counts = countItems(tpl, draft, needItems);

  return (
    <>
      <AppHeader title={tpl.box.box_code} subtitle={tpl.box.box_name} backHref="/home" />
      <main className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
        {/* Box info */}
        <section className="card p-4">
          <h2 className="text-lg font-bold">{tpl.box.box_name}</h2>
          <p className="text-sm text-slate-500">
            {tpl.box.location_description}
            {tpl.box.area ? ` · ${tpl.box.area}` : ''}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Last inspection: {formatDate(tpl.last_inspection?.created_at)} · Inspector: {me.full_name}
          </p>
        </section>

        {submitError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>
        )}

        {step === 'form' && (
          <>
            {/* Quick inspection */}
            <section className="card p-4">
              <h3 className="mb-1 text-center text-xl font-bold">Quick Inspection</h3>
              <p className="mb-4 text-center text-sm text-slate-400">〜〜〜</p>
              <div className="divide-y divide-slate-100">
                {QUESTIONS.map((q) => (
                  <div key={q.key} className="flex items-center justify-between gap-3 py-3">
                    <span className="font-medium">{q.label}</span>
                    <div className="w-40">
                      <YesNo value={a[q.key]} onChange={(v) => setAnswer(q.key, v)} />
                    </div>
                  </div>
                ))}
              </div>
              {a.seal_intact === false && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Seal not intact — please verify the items below before submitting.
                </p>
              )}
              {hasKnownExpired && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  This box has an expired item due for replacement — item check required.
                </p>
              )}
            </section>

            {/* Conditional item checklist */}
            {needItems && (
              <section className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="font-bold">Detailed Item Check</h3>
                  <button onClick={markRemainingOk} className="btn btn-secondary btn-md">
                    Mark remaining OK
                  </button>
                </div>
                {tpl.items.map((it) => (
                  <ItemCheckCard
                    key={it.box_item_id}
                    item={it}
                    value={draft.items[it.box_item_id] ?? {}}
                    onChange={(next) => setItem(it.box_item_id, next)}
                  />
                ))}
              </section>
            )}

            {/* Optional notes + photo */}
            <section className="card p-4">
              <label className="block">
                <span className="label">Notes (optional)</span>
                <textarea
                  className="textarea"
                  rows={2}
                  maxLength={2000}
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                />
              </label>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-600">
                  Add a box photo (optional)
                </summary>
                <div className="mt-3">
                  <PhotoCapture initialUrl={photo?.url ?? null} onChange={setPhoto} disabled={submitting} />
                </div>
              </details>
            </section>
          </>
        )}

        {step === 'review' && (
          <ReviewSummary
            counts={counts}
            answers={a}
            needItems={needItems}
            onBack={() => setStep('form')}
          />
        )}
      </main>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {step === 'form' ? (
            <button onClick={goReview} className="btn btn-lg btn-primary w-full">
              {needItems ? 'Save Item Check & Review' : 'Submit Inspection'}
            </button>
          ) : (
            <button onClick={submit} disabled={submitting} className="btn btn-lg btn-primary w-full">
              {submitting ? (
                <>
                  <Spinner className="h-5 w-5" /> Submitting…
                </>
              ) : (
                'Confirm & Submit'
              )}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

interface Counts {
  ok: number;
  low: number;
  missing: number;
  expired: number;
  quickIssues: string[];
}
function countItems(tpl: InspectionTemplateResponse, draft: QuickDraft, needItems: boolean): Counts {
  const c: Counts = { ok: 0, low: 0, missing: 0, expired: 0, quickIssues: [] };
  if (needItems) {
    for (const it of tpl.items) {
      const s = draft.items[it.box_item_id]?.status;
      if (s === 'OK') c.ok++;
      else if (s === 'Low Qty') c.low++;
      else if (s === 'Missing') c.missing++;
      else if (s === 'Expired' && it.has_expiry) c.expired++;
    }
  }
  const a = draft.answers;
  if (a.box_accessible === false) c.quickIssues.push('Box Accessibility Issue');
  if (a.box_clean === false) c.quickIssues.push('Box Condition Issue');
  if (a.contact_visible === false) c.quickIssues.push('Emergency Contact Not Visible');
  return c;
}

function ReviewSummary({
  counts,
  answers,
  needItems,
  onBack,
}: {
  counts: Counts;
  answers: QuickDraft['answers'];
  needItems: boolean;
  onBack: () => void;
}) {
  const actionsCount = counts.quickIssues.length + counts.low + counts.missing + counts.expired;
  const allGood = actionsCount === 0;
  return (
    <section className="card space-y-4 p-5">
      <h3 className="text-lg font-bold">Review</h3>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Stat label="Box accessible" ok={answers.box_accessible !== false} />
        <Stat label="Clean & undamaged" ok={answers.box_clean !== false} />
        <Stat label="Seal intact" ok={answers.seal_intact !== false} />
        <Stat label="Contact visible" ok={answers.contact_visible !== false} />
      </div>

      {needItems && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Tile n={counts.ok} label="OK" tone="ok" />
          <Tile n={counts.low} label="Low" tone="warn" />
          <Tile n={counts.missing} label="Missing" tone="bad" />
          <Tile n={counts.expired} label="Expired" tone="bad" />
        </div>
      )}

      <div className="rounded-xl bg-slate-50 p-3">
        {allGood ? (
          <p className="font-medium text-emerald-700">Everything looks good — box will be marked Ready. ✅</p>
        ) : (
          <p className="font-medium text-amber-800">
            {actionsCount} action{actionsCount === 1 ? '' : 's'} will be raised for the ESH team.
          </p>
        )}
      </div>

      <button onClick={onBack} className="btn btn-secondary btn-md w-full">
        ‹ Back to edit
      </button>
    </section>
  );
}

function Stat({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? 'text-emerald-600' : 'text-red-600'}>{ok ? '✓' : '✕'}</span>
      <span>{label}</span>
    </div>
  );
}
function Tile({ n, label, tone }: { n: number; label: string; tone: 'ok' | 'warn' | 'bad' }) {
  const cls = tone === 'ok' ? 'status-ok' : tone === 'warn' ? 'status-warn' : 'status-bad';
  return (
    <div className={`rounded-xl p-2 ${cls}`}>
      <p className="text-xl font-bold">{n}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

function ResultView({
  result,
  tpl,
}: {
  result: QuickInspectionResult;
  tpl: InspectionTemplateResponse;
}) {
  const ready = result.overall_status === 'Ready';
  return (
    <>
      <AppHeader title="Inspection submitted" subtitle={tpl.box.box_code} />
      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <section className="card flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-5xl">{ready ? '✅' : '⚠️'}</div>
          <ReadinessBadge status={result.overall_status} />
          {result.item_check_performed && (
            <p className="text-sm text-slate-500">
              {result.summary.ok} OK · {result.summary.low_qty} low · {result.summary.missing} missing ·{' '}
              {result.summary.expired} expired
            </p>
          )}
        </section>

        <section className="card p-4">
          <h3 className="mb-2 font-semibold">Actions raised ({result.actions.length})</h3>
          {result.actions.length === 0 ? (
            <p className="text-sm text-slate-500">No issues — nothing for ESH to action. 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {result.actions.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{a.action_type}</p>
                    <p className="text-xs text-slate-500">
                      {a.action_code}
                      {a.item_name ? ` · ${a.item_name}` : ''}
                    </p>
                  </div>
                  <PriorityBadge priority={a.priority} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid grid-cols-2 gap-3">
          <a href="/home" className="btn btn-lg btn-secondary">
            Home
          </a>
          <a href="/my-boxes" className="btn btn-lg btn-primary">
            My boxes
          </a>
        </div>
        <div className="pt-2 text-center">
          <Badge tone="neutral">Thank you</Badge>
        </div>
      </main>
    </>
  );
}
