'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiClientError, type UsageSubmitBody } from '@/lib/client/api.ts';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Spinner } from '@/components/Spinner';

export default function UsagePage() {
  return (
    <Suspense fallback={null}>
      <UsageInner />
    </Suspense>
  );
}

function UsageInner() {
  const sp = useSearchParams();
  const boxId = sp.get('box'); // set by the QR code on the physical box
  const boxCode = sp.get('code'); // display-only hint

  const [userName, setUserName] = useState('');
  const [department, setDepartment] = useState('');
  const [purpose, setPurpose] = useState('');
  const [items, setItems] = useState('');
  const [notes, setNotes] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!boxId) {
    return (
      <Shell>
        <div className="card space-y-2 p-6 text-center">
          <div className="text-4xl">📷</div>
          <h1 className="text-lg font-bold">Scan the box QR code</h1>
          <p className="text-slate-600">
            To report first aid usage, please scan the QR code on the first aid box.
          </p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="card space-y-3 p-8 text-center">
          <div className="text-5xl">✅</div>
          <h1 className="text-lg font-bold">Thank you</h1>
          <p className="text-slate-600">Your first aid usage has been recorded.</p>
          <button
            onClick={() => {
              setDone(false);
              setUserName('');
              setDepartment('');
              setPurpose('');
              setItems('');
              setNotes('');
            }}
            className="btn btn-lg btn-secondary"
          >
            Record another
          </button>
        </div>
      </Shell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: UsageSubmitBody = {
        box_id: boxId!,
        user_name: userName.trim(),
        department: department.trim(),
        usage_purpose: purpose.trim(),
        items_taken: items
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 50),
        notes: notes.trim() || null,
        website, // honeypot (must stay empty)
      };
      await api.submitUsage(body);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        setError('Too many submissions from this device. Please try again later.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not record usage. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <div className="mb-4 text-center">
        <CompanyLogo className="mx-auto mb-4 h-10 w-auto max-w-[190px]" />
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl text-white">
          ✚
        </div>
        <h1 className="text-xl font-bold">Record First Aid Usage</h1>
        <p className="text-sm text-slate-500">{boxCode ? `Box: ${boxCode}` : 'Thank you for reporting.'}</p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-5">
        <label className="block">
          <span className="label">Your name</span>
          <input className="input" required minLength={2} value={userName} onChange={(e) => setUserName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Department</span>
          <input className="input" required value={department} onChange={(e) => setDepartment(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">What did you use it for?</span>
          <textarea
            className="textarea"
            required
            minLength={3}
            rows={2}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Treated a minor cut"
          />
        </label>
        <label className="block">
          <span className="label">Items taken (comma separated)</span>
          <input
            className="input"
            value={items}
            onChange={(e) => setItems(e.target.value)}
            placeholder="e.g. Handyplast, Alcohol swab"
          />
        </label>
        <label className="block">
          <span className="label">Notes (optional)</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {/* Honeypot: hidden from humans, often filled by bots. */}
        <div aria-hidden className="hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        )}

        <button type="submit" disabled={submitting} className="btn btn-lg btn-primary w-full">
          {submitting ? <Spinner className="h-5 w-5" /> : 'Submit'}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">{children}</main>;
}
