// Superadmin-only user management. This route uses the Supabase service-role
// client because creating/deleting Auth users cannot be done safely from the
// browser.

import { requireActive, requireRole } from '@/lib/auth';
import { ApiError, badRequest, forbidden, jsonOk, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  adminUserCreateSchema,
  adminUserDeleteSchema,
  adminUserUpdateSchema,
  firstZodMessage,
} from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProfileRow {
  id: string;
  role: string;
  is_active: boolean;
}

export async function GET(): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['superadmin']);

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .select('id, full_name, employee_id, department, email, role, is_active')
      .order('full_name');

    if (error) {
      console.error('[admin/users] list failed:', error.message);
      throw new ApiError(500, 'users_failed', 'Could not load users.');
    }

    return jsonOk({ users: data ?? [] });
  });
}

export async function POST(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['superadmin']);

    const parsed = adminUserCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const body = parsed.data;

    const admin = createAdminClient();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name },
    });

    if (createErr || !created.user) {
      throw badRequest(createErr?.message ?? 'Could not create user.');
    }

    const profile = {
      id: created.user.id,
      full_name: body.full_name,
      employee_id: body.employee_id ?? null,
      department: body.department ?? null,
      email: body.email,
      role: body.role,
      is_active: body.is_active,
    };

    const { error: profileErr } = await admin.from('profiles').upsert(profile, { onConflict: 'id' });
    if (profileErr) {
      console.error('[admin/users] profile upsert failed:', profileErr.message);
      await admin.auth.admin.deleteUser(created.user.id);
      throw new ApiError(500, 'users_failed', 'User was not created because the profile could not be saved.');
    }

    return jsonOk({ ok: true, user: profile }, 201);
  });
}

export async function PATCH(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['superadmin']);

    const parsed = adminUserUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const body = parsed.data;

    const admin = createAdminClient();
    const existing = await getProfile(admin, body.id);
    if (!existing) throw badRequest('User profile not found.');

    const selfChange =
      body.id === ctx.userId &&
      ((body.role && body.role !== 'superadmin') || body.is_active === false);
    if (selfChange) throw forbidden('You cannot remove your own Superadmin access.');

    const removesActiveSuperadmin =
      existing.role === 'superadmin' &&
      existing.is_active &&
      ((body.role && body.role !== 'superadmin') || body.is_active === false);
    if (removesActiveSuperadmin) await requireAnotherActiveSuperadmin(admin, body.id);

    const patch: Record<string, unknown> = {};
    if (body.full_name !== undefined) patch.full_name = body.full_name;
    if (body.employee_id !== undefined) patch.employee_id = body.employee_id;
    if (body.department !== undefined) patch.department = body.department;
    if (body.role !== undefined) patch.role = body.role;
    if (body.is_active !== undefined) patch.is_active = body.is_active;

    if (Object.keys(patch).length === 0) return jsonOk({ ok: true });

    const { error } = await admin.from('profiles').update(patch).eq('id', body.id);
    if (error) throw badRequest(error.message);

    return jsonOk({ ok: true });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['superadmin']);

    const parsed = adminUserDeleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const { id } = parsed.data;

    if (id === ctx.userId) throw forbidden('You cannot delete your own Superadmin account.');

    const admin = createAdminClient();
    const existing = await getProfile(admin, id);
    if (existing?.role === 'superadmin' && existing.is_active) await requireAnotherActiveSuperadmin(admin, id);

    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw badRequest(error.message);

    return jsonOk({ ok: true });
  });
}

async function getProfile(admin: ReturnType<typeof createAdminClient>, id: string): Promise<ProfileRow | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[admin/users] profile lookup failed:', error.message);
    throw new ApiError(500, 'users_failed', 'Could not verify the user profile.');
  }
  return (data as ProfileRow | null) ?? null;
}

async function requireAnotherActiveSuperadmin(
  admin: ReturnType<typeof createAdminClient>,
  excludingId: string,
): Promise<void> {
  const { count, error } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'superadmin')
    .eq('is_active', true)
    .neq('id', excludingId);

  if (error) {
    console.error('[admin/users] superadmin count failed:', error.message);
    throw new ApiError(500, 'users_failed', 'Could not verify Superadmin access.');
  }
  if ((count ?? 0) === 0) {
    throw forbidden('At least one active Superadmin account is required.');
  }
}
