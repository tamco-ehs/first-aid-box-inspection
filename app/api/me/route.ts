// GET /api/me - the logged-in user's profile + role, used to drive redirects.
// Intentionally uses requireAuth (not requireActive) so the frontend can detect
// and explain a deactivated account instead of getting a blank 403.

import { requireAuth } from '@/lib/auth';
import { jsonOk, safe } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return safe(async () => {
    const ctx = await requireAuth();
    return jsonOk({
      id: ctx.userId,
      full_name: ctx.profile.full_name,
      employee_id: ctx.profile.employee_id,
      department: ctx.profile.department,
      email: ctx.email,
      role: ctx.profile.role,
      is_active: ctx.profile.is_active,
    });
  });
}
