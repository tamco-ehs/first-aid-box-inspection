'use client';

// Supabase client for the browser. Stores the session in cookies (via
// @supabase/ssr) so the server API routes can read it. Carries only the public
// anon key; every query is subject to RLS. Used for login and for admin
// direct-table management (admin RLS policies enforce admin-only writes).

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

// Loosely typed (schema = any) so admin insert/update payloads aren't inferred
// as `never`. RLS - not these types - is what authorizes the writes.
type LooseClient = SupabaseClient<any, 'public', any>;

let cached: LooseClient | null = null;

export function getSupabaseBrowserClient(): LooseClient {
  if (!cached) cached = createBrowserClient<any, 'public', any>(url, anonKey);
  return cached;
}
