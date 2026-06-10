// =============================================================================
// Supabase client bound to the CURRENT USER's session (reads the auth cookies).
// All queries through this client are subject to Row Level Security AS THAT
// USER - it is the RLS-enforced path and carries only the public anon key.
// =============================================================================

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { PUBLIC_ENV } from '@/lib/env';

export async function createUserClient() {
  const cookieStore = await cookies();

  return createServerClient<any, 'public', any>(
    PUBLIC_ENV.supabaseUrl(),
    PUBLIC_ENV.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // In route handlers this persists refreshed sessions. In contexts
          // where cookies are read-only (e.g. during render) it throws; ignore.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* read-only context */
          }
        },
      },
    },
  );
}
