'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Me, Role } from '@/lib/client/types.ts';

const TOUR_VERSION = 'v1';

type TourStep = {
  title: string;
  body: string;
  selector?: string;
  path?: string;
  pathLabel?: string;
};

type Rect = { top: number; left: number; width: number; height: number };

export function GuidedTour({ me }: { me: Me }) {
  const pathname = usePathname();
  const router = useRouter();
  const steps = useMemo(() => stepsFor(me.role, pathname), [me.role, pathname]);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index];

  useEffect(() => {
    if (steps.length === 0) return;
    const key = storageKey(me.id, me.role);
    if (localStorage.getItem(key) === 'done') return;
    const timer = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [me.id, me.role, steps.length]);

  useEffect(() => {
    if (!open || !step) return;

    function locate() {
      if (!step?.selector || !pathMatches(pathname, step.path)) {
        setRect(null);
        return;
      }
      const el = document.querySelector(step.selector);
      if (!(el instanceof HTMLElement)) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }

    locate();
    const timers = [window.setTimeout(locate, 350), window.setTimeout(locate, 900)];
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
    };
  }, [index, open, pathname, step]);

  if (!open || !step) return null;

  const current = index + 1;
  const total = steps.length;
  const routeOk = pathMatches(pathname, step.path);
  const canGoToPath = step.path && !routeOk;

  function finish() {
    localStorage.setItem(storageKey(me.id, me.role), 'done');
    setOpen(false);
  }

  function next() {
    if (index >= steps.length - 1) finish();
    else setIndex((n) => n + 1);
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-slate-950/35" />
      {rect && routeOk && (
        <div
          className="absolute rounded-2xl border-2 border-brand bg-white/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] transition-all"
          style={{
            top: Math.max(8, rect.top - 8),
            left: Math.max(8, rect.left - 8),
            width: rect.width + 16,
            height: rect.height + 16,
          }}
        />
      )}

      <section className="pointer-events-auto absolute inset-x-3 bottom-4 mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:right-5 sm:left-auto">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-bold text-brand">
            Step {current} of {total}
          </span>
          <button type="button" onClick={finish} className="text-sm font-semibold text-slate-500">
            Skip
          </button>
        </div>
        <h2 className="text-lg font-bold">{step.title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{step.body}</p>

        <div className="mt-4 flex gap-2">
          {index > 0 && (
            <button type="button" onClick={() => setIndex((n) => n - 1)} className="btn btn-md btn-secondary">
              Back
            </button>
          )}
          {canGoToPath && (
            <button type="button" onClick={() => router.push(step.path!)} className="btn btn-md btn-secondary">
              {step.pathLabel ?? 'Open page'}
            </button>
          )}
          <button type="button" onClick={next} className="btn btn-md btn-primary flex-1">
            {index >= steps.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  );
}

function storageKey(userId: string, role: Role) {
  return `first-aid-tour:${TOUR_VERSION}:${userId}:${role}`;
}

function pathMatches(pathname: string, stepPath?: string) {
  if (!stepPath) return true;
  return pathname === stepPath || pathname.startsWith(`${stepPath}/`);
}

function stepsFor(role: Role, pathname: string): TourStep[] {
  if (pathname.startsWith('/inspect/')) return inspectionSteps();
  if (role === 'first_aider') return firstAiderSteps();
  if (pathname.startsWith('/reports') || role === 'viewer') return reportSteps();
  if (role === 'admin') return adminSteps();
  return [];
}

function firstAiderSteps(): TourStep[] {
  return [
    {
      title: 'Start with your assigned boxes',
      body: 'This list shows the boxes you are responsible for. Boxes due or overdue appear first.',
      selector: '[data-tour="box-list"]',
      path: '/my-boxes',
      pathLabel: 'Open boxes',
    },
    {
      title: 'Start the inspection',
      body: 'Open the box you are checking. The app will guide you one item at a time so you do not need to scroll through a long checklist.',
      selector: '[data-tour="inspect-link"]',
      path: '/my-boxes',
      pathLabel: 'Open boxes',
    },
  ];
}

function inspectionSteps(): TourStep[] {
  return [
    {
      title: 'Confirm the box first',
      body: 'Check the box code, location, area, and inspector name before starting. This prevents inspection records being saved against the wrong box.',
      selector: '[data-tour="inspect-start"]',
    },
    {
      title: 'One item at a time',
      body: 'During inspection, focus on the current item only. Tap Still OK or Issue / Change depending on what you see physically.',
      selector: '[data-tour="inspect-current-item"]',
    },
    {
      title: 'Progress stays visible',
      body: 'Use the compact progress area and All items button to jump back to any item without losing your draft.',
      selector: '[data-tour="inspect-progress"]',
    },
    {
      title: 'Finish with evidence',
      body: 'On final review, upload the live box photo and submit. This creates the auditable inspection record.',
      selector: '[data-tour="submit-inspection"]',
    },
  ];
}

function adminSteps(): TourStep[] {
  return [
    {
      title: 'Admin tabs control setup and stock',
      body: 'Use these tabs to manage boxes, assignments, checklist items, box-level inventory, top-ups, and users.',
      selector: '[data-tour="admin-tabs"]',
      path: '/admin',
      pathLabel: 'Open admin',
    },
    {
      title: 'Top-ups are issued by box',
      body: 'Open Top-ups to tick items by box, issue all open items, or mark selected items as waiting stock.',
      selector: '[data-tour="admin-topups-tab"]',
      path: '/admin',
      pathLabel: 'Open admin',
    },
    {
      title: 'Dashboard is for decisions and audit',
      body: 'The dashboard shows what needs action and lets you download inspection audit PDFs for auditors.',
      selector: '[data-tour="admin-reports-link"]',
      path: '/admin',
      pathLabel: 'Open admin',
    },
  ];
}

function reportSteps(): TourStep[] {
  return [
    {
      title: 'Start with the decision view',
      body: 'These cards show the important counts first: critical items, top-ups, replacements, expiry checks, and overdue inspections.',
      selector: '[data-tour="dashboard-decision"]',
      path: '/reports',
      pathLabel: 'Open reports',
    },
    {
      title: 'Action queue is the stock workflow',
      body: 'Use Action queue to issue stock by box. Tick only what you give out now and leave waiting-stock items open.',
      selector: '[data-tour="reports-action-tab"]',
      path: '/reports',
      pathLabel: 'Open reports',
    },
    {
      title: 'Download audit PDFs',
      body: 'Each inspection row has a PDF button with timestamp, inspection details, item results, corrective actions, and an audit fingerprint.',
      selector: '[data-tour="inspection-pdf"]',
      path: '/reports',
      pathLabel: 'Open reports',
    },
  ];
}
