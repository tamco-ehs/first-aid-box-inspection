'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TamcoBrandLockup } from '@/components/BrandLogo';
import { Spinner, FullScreenLoader } from '@/components/Spinner';
import { validatePasswordReset } from '@/lib/logic/password-reset';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type RecoveryStatus = 'checking' | 'ready' | 'invalid' | 'saved';
type RecoveryResult = { ok: true } | { ok: false; message: string };

let currentRecovery: { key: string; promise: Promise<RecoveryResult> } | null = null;

function recoveryMessage(message: string): string {
  if (/expired|invalid|otp|token|session/i.test(message)) {
    return 'This reset link is invalid or expired. Please request a new one.';
  }
  return 'Could not verify the reset link. Please request a new one.';
}

function recoveryErrorFromUrl(url: URL, hashParams: URLSearchParams): string | null {
  const errorCode = url.searchParams.get('error_code') ?? hashParams.get('error_code');
  const errorDescription = url.searchParams.get('error_description') ?? hashParams.get('error_description');
  const error = url.searchParams.get('error') ?? hashParams.get('error');

  if (!error && !errorCode && !errorDescription) return null;
  if (errorCode === 'otp_expired' || /expired|invalid/i.test(errorDescription ?? '')) {
    return 'This reset link is invalid or expired. Request one new link, then use the newest email only.';
  }
  return errorDescription ?? 'Could not verify the reset link. Please request a new one.';
}

async function prepareRecoverySession(): Promise<RecoveryResult> {
  const supabase = getSupabaseBrowserClient();
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const urlError = recoveryErrorFromUrl(url, hashParams);
  const key = code ?? tokenHash ?? accessToken ?? urlError ?? 'existing-session';

  if (currentRecovery?.key === key) return currentRecovery.promise;

  currentRecovery = {
    key,
    promise: (async () => {
      try {
        if (urlError) return { ok: false, message: urlError };

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
        if (!data.session) {
          return {
            ok: false,
            message: 'This reset link is invalid or expired. Please request a new one.',
          };
        }

        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? recoveryMessage(e.message) : 'Could not verify the reset link.',
        };
      }
    })(),
  };

  return currentRecovery.promise;
}

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<RecoveryStatus>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    prepareRecoverySession().then((result) => {
      if (!active) return;
      window.history.replaceState(null, '', '/reset-password');
      if (result.ok) {
        setStatus('ready');
        return;
      }
      setStatus('invalid');
      setError(result.message);
    });

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
        <TamcoBrandLockup title="Password Updated" subtitle="TAMCO EHS readiness system" className="mb-8" priority />
        <div className="card space-y-4 p-6 text-center">
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
      <TamcoBrandLockup title="Set New Password" subtitle="Use a new password for your account" className="mb-8" priority />

      <form onSubmit={onSubmit} className="card space-y-4 p-6">
        {status === 'invalid' ? (
          <>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Request only one reset email, wait for it to arrive, then open the newest link. Supabase may block repeated requests for about 60 seconds.
            </p>
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
