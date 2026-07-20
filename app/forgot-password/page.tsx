'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3000';
}

function friendlyResetError(message: string): string {
  if (/rate|security purposes/i.test(message)) return 'Too many reset requests. Please wait a moment and try again.';
  if (/redirect|not allowed|uri/i.test(message)) return 'Password reset is not fully configured. Please contact EHS/Admin.';
  return 'Could not send the reset email. Please try again.';
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEmail(params.get('email') ?? '');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const { error: resetError } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${appBaseUrl()}/reset-password`,
    });

    if (resetError) {
      setError(friendlyResetError(resetError.message));
      setSubmitting(false);
      return;
    }

    setSent(true);
    setSubmitting(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-3xl text-white">
          +
        </div>
        <h1 className="text-2xl font-bold">Reset Password</h1>
        <p className="text-sm text-slate-500">Get a secure reset link by email</p>
      </div>

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
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            If this email belongs to an active account, a reset link has been sent. Open the link to set a new password.
          </p>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

        <button type="submit" disabled={submitting || !email.trim()} className="btn btn-lg btn-primary w-full">
          {submitting ? <Spinner className="h-5 w-5" /> : sent ? 'Send again' : 'Send reset link'}
        </button>

        <Link href="/login" className="btn btn-lg btn-secondary w-full">
          Back to sign in
        </Link>
      </form>
    </main>
  );
}
