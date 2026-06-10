// =============================================================================
// Auth + authorization helpers. Every protected route calls requireActive()
// first, then a role/assignment check. These re-verify identity and access
// SERVER-SIDE on every request - frontend checks are never trusted.
// =============================================================================

import { createUserClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { forbidden, unauthorized } from '@/lib/http';
import type { Role } from '@/lib/logic/types.ts';

export interface Profile {
  id: string;
  full_name: string;
  employee_id: string | null;
  department: string | null;
  email: string | null;
  role: Role;
  is_active: boolean;
}

export interface AuthContext {
  userId: string;
  email: string | null;
  profile: Profile;
}

/**
 * Resolve the caller from their session cookie and load their profile.
 * getUser() validates the JWT against the Supabase auth server (not a local
 * decode), so a forged/expired token is rejected.
 * @throws 401 if not logged in, 403 if no profile row exists.
 */
export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw unauthorized();

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, full_name, employee_id, department, email, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[auth] profile lookup failed:', error.message);
    throw unauthorized('Could not verify your account.');
  }
  if (!profile) throw forbidden('No profile is associated with this account.');

  return {
    userId: user.id,
    email: user.email ?? (profile as Profile).email,
    profile: profile as Profile,
  };
}

/** requireAuth + reject deactivated accounts. Use this in nearly every route. */
export async function requireActive(): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!ctx.profile.is_active) {
    throw forbidden('Your account is inactive. Please contact an administrator.');
  }
  return ctx;
}

/** Throw 403 unless the caller's role is one of `roles`. */
export function requireRole(ctx: AuthContext, roles: Role[]): void {
  if (!roles.includes(ctx.profile.role)) {
    throw forbidden('You do not have permission to perform this action.');
  }
}

/** Active box IDs assigned to a first aider (empty for none). */
export async function getAssignedBoxIds(profileId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('box_assignments')
    .select('box_id')
    .eq('profile_id', profileId)
    .eq('is_active', true);

  if (error) {
    console.error('[auth] assignment lookup failed:', error.message);
    throw forbidden('Could not verify your box assignments.');
  }
  return (data ?? []).map((r) => (r as { box_id: string }).box_id);
}

/** Does this first aider hold an active assignment for the box? */
export async function isAssignedToBox(profileId: string, boxId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('box_assignments')
    .select('id')
    .eq('profile_id', profileId)
    .eq('box_id', boxId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[auth] assignment check failed:', error.message);
    return false;
  }
  return Boolean(data);
}

/**
 * Authorize access to a specific box for the current action.
 *  - admin: any box
 *  - viewer: read only (write=false)
 *  - first_aider: only boxes they are actively assigned to
 * @throws 403 otherwise.
 */
export async function requireBoxAccess(
  ctx: AuthContext,
  boxId: string,
  opts: { write: boolean },
): Promise<void> {
  const { role } = ctx.profile;

  if (role === 'admin') return;

  if (role === 'viewer') {
    if (opts.write) throw forbidden('Viewers cannot modify data.');
    return; // read-only access to boxes/reports
  }

  if (role === 'first_aider') {
    const ok = await isAssignedToBox(ctx.userId, boxId);
    if (!ok) throw forbidden('You are not assigned to this first aid box.');
    return;
  }

  throw forbidden();
}
