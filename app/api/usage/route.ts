// POST /api/usage - record that someone took items from a first aid box.
//
// Submission model is configurable (PUBLIC_USAGE_SUBMISSION_ENABLED):
//   true  -> public can submit WITHOUT login (factory staff at a box). Still
//            validated, honeypot-guarded, and rate-limited per salted IP hash
//            plus a global hourly cap. Nobody can ever READ logs without login
//            (no select policy for anon/first_aider; admin/viewer only).
//   false -> an active login is required to submit.
//
// Writes use the service role because there is deliberately NO insert policy on
// first_aid_usage_logs for any role. The response is generic - no data is ever
// echoed back and no usage history is exposed.

import { createHash } from 'node:crypto';
import { requireActive } from '@/lib/auth';
import { badRequest, getClientIp, jsonOk, safe, tooManyRequests } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { SERVER_ENV } from '@/lib/env';
import { usageSchema, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hashIp(ip: string): string {
  return createHash('sha256').update(ip + SERVER_ENV.ipHashSalt()).digest('hex');
}

export async function POST(req: Request): Promise<Response> {
  return safe(async () => {
    const publicEnabled = SERVER_ENV.publicUsageEnabled();

    // When public submission is OFF, require an active account.
    if (!publicEnabled) {
      await requireActive();
    }

    const parsed = usageSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const body = parsed.data;

    // Honeypot (schema already enforces empty; explicit guard for clarity).
    if (body.website && body.website.length > 0) {
      return jsonOk({ ok: true, message: 'Thank you. Your first aid usage has been recorded.' }, 201);
    }

    const admin = createAdminClient();
    const ipHash = hashIp(getClientIp(req));
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();

    // Per-IP rate limit
    const { count: perIp } = await admin
      .from('first_aid_usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('client_ip_hash', ipHash)
      .gte('created_at', oneHourAgo);
    if ((perIp ?? 0) >= SERVER_ENV.usageRateLimitPerIpPerHour()) {
      throw tooManyRequests('You have submitted too many times. Please try again later.');
    }

    // Global hourly cap (abuse circuit-breaker)
    const { count: globalCount } = await admin
      .from('first_aid_usage_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', oneHourAgo);
    if ((globalCount ?? 0) >= SERVER_ENV.usageRateLimitGlobalPerHour()) {
      throw tooManyRequests();
    }

    // Box must exist and be active.
    const { data: box } = await admin
      .from('boxes')
      .select('id, is_active')
      .eq('id', body.box_id)
      .maybeSingle();
    if (!box || !(box as { is_active: boolean }).is_active) {
      throw badRequest('Invalid or inactive first aid box.');
    }

    const { error } = await admin.from('first_aid_usage_logs').insert({
      box_id: body.box_id,
      user_name: body.user_name,
      department: body.department,
      usage_purpose: body.usage_purpose,
      items_taken: body.items_taken ?? null,
      notes: body.notes ?? null,
      client_ip_hash: ipHash,
    });
    if (error) {
      console.error('[usage] insert failed:', error.message);
      throw badRequest('Could not record usage. Please try again.');
    }

    // Generic acknowledgement only - never reveal data or history.
    return jsonOk({ ok: true, message: 'Thank you. Your first aid usage has been recorded.' }, 201);
  });
}
