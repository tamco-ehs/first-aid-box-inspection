'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TamcoBrandLockup } from '@/components/BrandLogo';
import { Spinner } from '@/components/Spinner';
import { isPasswordResetRateLimit } from '@/lib/logic/password-reset';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const RESET_COOLDOWN_SECONDS = 60;

function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3000';
}

function friendlyResetError(message: string): string {
  if (isPasswordResetRateLimit(message)) return 'Too many reset requests. Please wait 60 seconds, then request a new link.';
  if (/redirect|not allowed|uri/i.test(message)) return 'Password reset is not fully configured. Please contact EHS/Admin.';
  return 'Could not send the reset email. Please try again.';
}

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

    const { error: resetError } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${appBaseUrl()}/reset-password`,
    });

    if (resetError) {
      setError(friendlyResetError(resetError.message));
      if (isPasswordResetRateLimit(resetError.message)) setCooldown(RESET_COOLDOWN_SECONDS);
      setSubmitting(false);
      return;
    }

    setSent(true);
    setCooldown(RESET_COOLDOWN_SECONDS);
    setSubmitting(false);
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
            <p>If this email belongs to an active account, a reset link has been sent.</p>
            <p className="mt-1 text-xs">
              Use the newest email only. Older reset links stop working after a new request.
            </p>
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

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
