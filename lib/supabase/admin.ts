// =============================================================================
// Supabase ADMIN client - uses the service role key and BYPASSES RLS.
//
// *** SERVER-ONLY. Never import this from a client component or anything that
//     ends up in the browser bundle. ***
//
// Used by API routes ONLY AFTER they have authenticated the user and
// explicitly authorized the action (role + box assignment). It is the tier
// that performs privileged reads/writes (e.g. creating top-up requests,
// updating box state, reading reports across all boxes). RLS remains the
// safety net for any path that uses the anon key (createUserClient).
// =============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_ENV, SERVER_ENV } from '@/lib/env';

// We intentionally do NOT generate DB types here; the client is loosely typed
// (schema = any) so inserts/updates accept our payloads. Correctness of those
// payloads is guaranteed by zod validation + the DB CHECK constraints, not by
// generated row types.
type LooseClient = SupabaseClient<any, 'public', any>;

let cached: LooseClient | null = null;

export function createAdminClient(): LooseClient {
  if (cached) return cached;
  cached = createClient<any, 'public', any>(
    PUBLIC_ENV.supabaseUrl(),
    SERVER_ENV.supabaseServiceRoleKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'X-Client-Info': 'first-aid-system/server' } },
    },
  );
  return cached;
}
