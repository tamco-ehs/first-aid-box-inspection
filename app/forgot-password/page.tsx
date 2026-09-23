'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TamcoBrandLockup } from '@/components/BrandLogo';
import { Spinner } from '@/components/Spinner';

const RESET_COOLDOWN_SECONDS = 60;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEmail(params.get('email') ?? '');
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || cooldown > 0) return;
    setSubmitting(true);
    setError(null);
    setSent(false);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const result = await response.json() as { error?: string; retryAfter?: number };
      if (!response.ok) {
        setError(result.error ?? 'Could not send the reset email. Please try again.');
        if (response.status === 429) setCooldown(result.retryAfter ?? RESET_COOLDOWN_SECONDS);
        return;
      }
      setSent(true);
      setCooldown(result.retryAfter ?? RESET_COOLDOWN_SECONDS);
    } catch {
      setError('Could not connect. Check your internet connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <TamcoBrandLockup title="Reset Password" subtitle="Get a secure reset link by email" className="mb-8" priority />

      <form onSubmit={onSubmit} className="card space-y-4 p-6">
        <label className="block">
          <span className="label">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>

        {sent && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            <p>If this email belongs to an active account, you will receive a reset link shortly. Check your spam or junk folder too.</p>
            <p className="mt-1 text-xs">
              Use the newest email only. Older reset links stop working after a new request.
            </p>
          </div>
        )}

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

        <button type="submit" disabled={submitting || cooldown > 0 || !email.trim()} className="btn btn-lg btn-primary w-full">
          {submitting ? (
            <Spinner className="h-5 w-5" />
          ) : cooldown > 0 ? (
            `Send again in ${cooldown}s`
          ) : sent ? (
            'Send again'
          ) : (
            'Send reset link'
          )}
        </button>

        <Link href="/login" className="btn btn-lg btn-secondary w-full">
          Back to sign in
        </Link>
      </form>
    </main>
  );
}
