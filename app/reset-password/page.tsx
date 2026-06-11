'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient, getSupabasePasswordResetClient } from '@/lib/supabase/client';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Spinner, FullScreenLoader } from '@/components/Spinner';

type RecoveryClient = 'main' | 'reset';

const RECOVERY_MARKER = 'first-aid-password-reset-active';

function friendlyResetError(msg: string): string {
  if (/code verifier|expired|invalid|otp/i.test(msg)) {
    return 'This reset link is expired or already used. Request a new reset email and open the newest link once.';
  }
  return msg || 'This reset link could not be used. Request a new password reset from the login page.';
}

function cleanResetUrl() {
  window.history.replaceState(null, '', '/reset-password');
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [recoveryClient, setRecoveryClient] = useState<RecoveryClient | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const resetClient = getSupabasePasswordResetClient();
    let active = true;

    function acceptRecovery(client: RecoveryClient, session: unknown) {
      if (!active) return;
      if (session) {
        sessionStorage.setItem(RECOVERY_MARKER, client);
        setRecoveryClient(client);
        setHasRecoverySession(Boolean(session));
        setChecking(false);
      }
    }

    const resetSub = resetClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') acceptRecovery('reset', session);
    }).data.subscription;

    async function loadRecoverySession() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const search = new URLSearchParams(window.location.search);
      const linkError = hash.get('error_description') ?? search.get('error_description');
      const code = search.get('code');
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');

      if (linkError) {
        setError(friendlyResetError(linkError.replace(/\+/g, ' ')));
        setHasRecoverySession(false);
        setChecking(false);
        return;
      }

      if (accessToken && refreshToken) {
        const { data, error: sessionError } = await resetClient.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!active) return;
        if (sessionError || !data.session) {
          setError(friendlyResetError(sessionError?.message ?? 'Invalid reset session.'));
          setHasRecoverySession(false);
          setChecking(false);
          return;
        }
        cleanResetUrl();
        acceptRecovery('reset', data.session);
        return;
      }

      if (code) {
        const mainClient = getSupabaseBrowserClient();
        const { data, error: exchangeError } = await mainClient.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (exchangeError || !data.session) {
          setError(friendlyResetError(exchangeError?.message ?? 'Invalid reset session.'));
          setHasRecoverySession(false);
          setChecking(false);
          return;
        }
        cleanResetUrl();
        acceptRecovery('main', data.session);
        return;
      }

      const markedClient = sessionStorage.getItem(RECOVERY_MARKER) as RecoveryClient | null;
      if (markedClient === 'reset') {
        const { data } = await resetClient.auth.getSession();
        if (!active) return;
        if (data.session) {
          acceptRecovery('reset', data.session);
          return;
        }
      } else if (markedClient === 'main') {
        const mainClient = getSupabaseBrowserClient();
        const { data } = await mainClient.auth.getSession();
        if (!active) return;
        if (data.session) {
          acceptRecovery('main', data.session);
          return;
        }
      }

      if (!active) return;
      setHasRecoverySession(false);
      setChecking(false);
    }

    void loadRecoverySession();

    return () => {
      active = false;
      resetSub.unsubscribe();
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
    const client =
      recoveryClient === 'main' ? getSupabaseBrowserClient() : getSupabasePasswordResetClient();
    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    sessionStorage.removeItem(RECOVERY_MARKER);
    await Promise.allSettled([
      getSupabaseBrowserClient().auth.signOut(),
      getSupabasePasswordResetClient().auth.signOut(),
    ]);
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
