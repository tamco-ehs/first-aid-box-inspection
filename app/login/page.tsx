'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { api } from '@/lib/client/api.ts';
import { takeIntendedPath } from '@/lib/client/intent.ts';
import { Spinner, FullScreenLoader } from '@/components/Spinner';

function friendlyAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(msg)) return 'Your email is not confirmed yet. Please contact EHS/Admin.';
  if (/rate/i.test(msg)) return 'Too many attempts. Please wait a moment and try again.';
  return 'Could not sign in. Please try again.';
}

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noBox, setNoBox] = useState(false);

  // Decide where to send the user once authenticated.
  async function routeAfterAuth() {
    const me = await api.me();
    if (!me.is_active) {
      setError('Your account is inactive. Please contact EHS/Admin.');
      await getSupabaseBrowserClient().auth.signOut();
      setChecking(false);
      setSubmitting(false);
      return;
    }

    // Honor a QR/deep link captured before login (the target page re-checks
    // authorization and shows "access blocked" if needed).
    const intended = takeIntendedPath();
    if (intended && intended.startsWith('/') && !intended.startsWith('/login')) {
      router.replace(intended);
      return;
    }

    if (me.role === 'admin') return router.replace('/admin');
    if (me.role === 'viewer') return router.replace('/reports');

    // first_aider -> assignment-based routing
    const boxes = await api.myBoxes();
    if (boxes.count === 0) {
      setNoBox(true);
      setChecking(false);
      setSubmitting(false);
      return;
    }
    if (boxes.count === 1) return router.replace(`/inspect/${boxes.boxes[0]!.box_id}`);
    return router.replace('/my-boxes');
  }

  // If already signed in, skip the form.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.me();
        if (active) await routeAfterAuth();
      } catch {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setNoBox(false);

    const { error: authError } = await getSupabaseBrowserClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      setError(friendlyAuthError(authError.message));
      setSubmitting(false);
      return;
    }
    try {
      await routeAfterAuth();
    } catch {
      setError('Signed in, but could not load your account. Please try again.');
      setSubmitting(false);
    }
  }

  if (checking) return <FullScreenLoader label="Checking your session…" />;

  if (noBox) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl">🧰</div>
        <h1 className="text-xl font-bold">No box assigned</h1>
        <p className="text-slate-600">No first aid box assigned to you. Please contact EHS/Admin.</p>
        <button
          onClick={async () => {
            await getSupabaseBrowserClient().auth.signOut();
            setNoBox(false);
          }}
          className="btn btn-lg btn-secondary"
        >
          Sign out
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-3xl text-white">
          ✚
        </div>
        <h1 className="text-2xl font-bold">First Aid Box Inspection</h1>
        <p className="text-sm text-slate-500">Sign in to continue</p>
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
        <label className="block">
          <span className="label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        )}

        <button type="submit" disabled={submitting} className="btn btn-lg btn-primary w-full">
          {submitting ? <Spinner className="h-5 w-5" /> : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-slate-400">
        Accounts are created by EHS/Admin. This is a private internal application.
      </p>
    </main>
  );
}
