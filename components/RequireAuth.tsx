'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/client/api.ts';
import { setIntendedPath } from '@/lib/client/intent.ts';
import type { Me, Role } from '@/lib/client/types.ts';
import { FullScreenLoader } from '@/components/Spinner';

// Client-side guard. The real enforcement is server-side in every API route;
// this only avoids rendering a page for someone who will be denied anyway, and
// routes a logged-out user (e.g. from a QR link) through /login and back.
export function RequireAuth({
  roles,
  children,
}: {
  roles?: Role[];
  children: (me: Me) => ReactNode;
}) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const m = await api.me();
        if (!active) return;
        if (!m.is_active || (roles && !roles.includes(m.role))) {
          setState('denied');
          return;
        }
        setMe(m);
        setState('ok');
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && err.status === 401) {
          setIntendedPath(window.location.pathname);
          router.replace('/login');
        } else {
          setState('denied');
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'loading') return <FullScreenLoader />;
  if (state === 'denied' || !me) return <AccessBlocked />;
  return <>{children(me)}</>;
}

export function AccessBlocked({
  message = 'You do not have access to this page.',
}: {
  message?: string;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">🔒</div>
      <h1 className="text-xl font-bold">Access blocked</h1>
      <p className="text-slate-600">{message}</p>
      <a href="/login" className="btn btn-lg btn-primary">
        Back to sign in
      </a>
    </main>
  );
}
