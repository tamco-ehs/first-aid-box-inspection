'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Spinner, FullScreenLoader } from '@/components/Spinner';

function friendlyResetError(msg: string): string {
  if (/code verifier|expired|invalid|otp/i.test(msg)) {
    return 'This reset link is expired, already used, or was opened in a different browser. Request a new reset email and open the newest link once.';
  }
  return msg || 'This reset link could not be used. Request a new password reset from the login page.';
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setHasRecoverySession(Boolean(session));
      }
    });

    async function loadRecoverySession() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const search = new URLSearchParams(window.location.search);
      const linkError = hash.get('error_description') ?? search.get('error_description');
      const code = search.get('code');

      if (linkError) {
        setError(friendlyResetError(linkError.replace(/\+/g, ' ')));
        setHasRecoverySession(false);
        setChecking(false);
        return;
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (exchangeError) {
          setError(friendlyResetError(exchangeError.message));
          setHasRecoverySession(false);
          setChecking(false);
          return;
        }
        window.history.replaceState(null, '', '/reset-password');
      }

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setHasRecoverySession(Boolean(data.session));
      setChecking(false);
    }

    void loadRecoverySession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    await getSupabaseBrowserClient().auth.signOut();
    setSuccess(true);
    setSubmitting(false);
    setTimeout(() => router.replace('/login'), 1200);
  }

  if (checking) return <FullScreenLoader label="Checking reset link..." />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="mb-8 text-center">
        <CompanyLogo className="mx-auto mb-5 h-12 w-auto max-w-[220px]" />
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-3xl text-white">
          +
        </div>
        <h1 className="text-2xl font-bold">Set New Password</h1>
        <p className="text-sm text-slate-500">Choose a new password for your account</p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-6">
        {!hasRecoverySession && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            This reset link is missing or expired. Request a new password reset from the login page.
          </p>
        )}

        <label className="block">
          <span className="label">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="label">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className="input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        )}

        {success && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            Password updated. Returning to sign in...
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !hasRecoverySession}
          className="btn btn-lg btn-primary w-full"
        >
          {submitting ? <Spinner className="h-5 w-5" /> : 'Update password'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-slate-400">
        <a href="/login" className="font-semibold text-brand">
          Back to sign in
        </a>
      </p>
    </main>
  );
}
