'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Spinner, FullScreenLoader } from '@/components/Spinner';
import { validatePasswordReset } from '@/lib/logic/password-reset';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type RecoveryStatus = 'checking' | 'ready' | 'invalid' | 'saved';

function recoveryMessage(message: string): string {
  if (/expired|invalid|otp|token|session/i.test(message)) {
    return 'This reset link is invalid or expired. Please request a new one.';
  }
  return 'Could not verify the reset link. Please request a new one.';
}

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<RecoveryStatus>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function prepareRecoverySession() {
      const supabase = getSupabaseBrowserClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const tokenHash = url.searchParams.get('token_hash');
      const type = url.searchParams.get('type');
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash && (!type || type === 'recovery')) {
          const { error: otpError } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
          if (otpError) throw otpError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        }

        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (!data.session) {
          setStatus('invalid');
          setError('This reset link is invalid or expired. Please request a new one.');
          return;
        }

        window.history.replaceState(null, '', '/reset-password');
        setStatus('ready');
      } catch (e) {
        if (!active) return;
        setStatus('invalid');
        setError(e instanceof Error ? recoveryMessage(e.message) : 'Could not verify the reset link.');
      }
    }

    prepareRecoverySession();
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const validation = validatePasswordReset(password, confirmPassword);
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message || 'Could not update password. Please request a new reset link.');
      setSaving(false);
      return;
    }

    await supabase.auth.signOut();
    setPassword('');
    setConfirmPassword('');
    setSaving(false);
    setStatus('saved');
  }

  if (status === 'checking') return <FullScreenLoader label="Checking reset link..." />;

  if (status === 'saved') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
        <div className="card space-y-4 p-6 text-center">
          <h1 className="text-2xl font-bold">Password Updated</h1>
          <p className="text-sm text-slate-500">Your password has been changed. Sign in with the new password.</p>
          <Link href="/login" className="btn btn-lg btn-primary w-full">
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-3xl text-white">
          +
        </div>
        <h1 className="text-2xl font-bold">Set New Password</h1>
        <p className="text-sm text-slate-500">Use a new password for your account</p>
      </div>

      <form onSubmit={onSubmit} className="card space-y-4 p-6">
        {status === 'invalid' ? (
          <>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
            <Link href="/forgot-password" className="btn btn-lg btn-primary w-full">
              Request new link
            </Link>
            <Link href="/login" className="btn btn-lg btn-secondary w-full">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <label className="block">
              <span className="label">New password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
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
                minLength={8}
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

            <button type="submit" disabled={saving} className="btn btn-lg btn-primary w-full">
              {saving ? <Spinner className="h-5 w-5" /> : 'Update password'}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
