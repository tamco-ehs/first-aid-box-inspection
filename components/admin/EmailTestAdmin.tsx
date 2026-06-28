'use client';

import { useState } from 'react';
import { api, type EmailTestResponse } from '@/lib/client/api.ts';
import { Spinner } from '@/components/Spinner';
import { Notice, Section } from './shared.tsx';

export function EmailTestAdmin() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EmailTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendTests() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.testEmails());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send test emails.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <Notice kind={result.ok ? 'ok' : 'error'}>
          Sent {result.sent} of {result.count} test emails to {result.recipient}.
        </Notice>
      )}

      <Section title="Email notification test">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium text-slate-900">Send all notification samples</p>
            <p className="text-sm text-slate-500">Subjects are prefixed with [TEST]. Reminder history is not changed.</p>
          </div>
          <button className="btn btn-md btn-primary" onClick={sendTests} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Send test emails'}
          </button>
        </div>

        {result && (
          <div className="mt-4 space-y-2">
            {result.results.map((item) => (
              <div
                key={item.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-semibold text-slate-900">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.id ?? item.error ?? 'No provider id returned'}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-bold ${
                    item.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {item.ok ? 'Sent' : 'Failed'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
