'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Spinner } from '@/components/Spinner';

// Sticky top bar. `backHref` shows a back chevron; `right` is an optional slot.
export function AppHeader({
  title,
  subtitle,
  backHref,
  right,
  showSignOut = true,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  right?: ReactNode;
  showSignOut?: boolean;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      router.replace('/login');
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
        {backHref && (
          <a href={backHref} className="btn btn-ghost -ml-2 h-10 w-10 rounded-full p-0" aria-label="Back">
            <span aria-hidden>‹</span>
          </a>
        )}
        <CompanyLogo className="h-7 w-auto max-w-[92px] shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
        {showSignOut && (
          <button onClick={signOut} disabled={signingOut} className="btn btn-ghost btn-md text-slate-600">
            {signingOut ? <Spinner className="h-4 w-4" /> : 'Sign out'}
          </button>
        )}
      </div>
    </header>
  );
}
