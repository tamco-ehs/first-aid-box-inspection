'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TamcoBrandLockup } from '@/components/BrandLogo';
import { Spinner, FullScreenLoader } from '@/components/Spinner';
import { validatePasswordReset } from '@/lib/logic/password-reset';
import { INVALID_RESET_LINK, parseRecoveryLink } from '@/lib/logic/password-recovery';
import { passwordRecoveryForLink } from '@/lib/client/password-recovery';

type RecoveryStatus = 'checking' | 'ready' | 'invalid' | 'saved';

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<RecoveryStatus>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);
  const reset = useRef<ReturnType<typeof passwordRecoveryForLink> | null>(null);

  useEffect(() => {
    // React Strict Mode must not prepare/consume a one-time link twice.
    if (initialized.current) return;
    initialized.current = true;
    const link = parseRecoveryLink(window.location.href);
    // Remove credentials before creating any client with automatic URL detection.
    window.history.replaceState(window.history.state, '', '/reset-password');
    if (link.kind === 'invalid') {
      setStatus('invalid');
      setError(INVALID_RESET_LINK);
      return;
    }
    try {
      reset.current = passwordRecoveryForLink(link);
      setStatus('ready');
    } catch {
      setStatus('invalid');
      setError('Password reset is unavailable. Please contact EHS/Admin.');
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !reset.current) return;
    const validation = validatePasswordReset(password, confirmPassword);
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await reset.current(password);
      if (!result.ok) {
        setError(result.error ?? 'Could not update your password. Please try again.');
        if (result.invalid) setStatus('invalid');
        return;
      }
      reset.current = null;
      setPassword('');
      setConfirmPassword('');
      setStatus('saved');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'checking') return <FullScreenLoader label="Opening password reset..." />;

  if (status === 'saved') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
        <TamcoBrandLockup title="Password Updated" subtitle="TAMCO EHS readiness system" className="mb-8" priority />
        <div className="card space-y-4 p-6 text-center" role="status">
          <p className="text-sm text-slate-500">Your password has been changed. Sign in with the new password.</p>
          <Link href="/login" className="btn btn-lg btn-primary w-full">Go to sign in</Link>
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
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
            <p className="text-sm text-slate-500">Request a new email and open its link. You can use a different browser or device.</p>
            <Link href="/forgot-password" className="btn btn-lg btn-primary w-full">Request new link</Link>
            <Link href="/login" className="btn btn-lg btn-secondary w-full">Back to sign in</Link>
          </>
        ) : (
          <>
            <label className="block">
              <span className="label">New password</span>
              <input type="password" autoComplete="new-password" required minLength={8} maxLength={72}
                className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Confirm new password</span>
              <input type="password" autoComplete="new-password" required minLength={8} maxLength={72}
                className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
            <button type="submit" disabled={saving} className="btn btn-lg btn-primary w-full">
              {saving ? <Spinner className="h-5 w-5" /> : 'Update password'}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
