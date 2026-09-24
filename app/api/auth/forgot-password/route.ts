import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_ENV, SERVER_ENV } from '@/lib/env';
import { getClientIp } from '@/lib/http';
import { sendEmail, validateEmailConfiguration } from '@/lib/email';
import { requestPasswordReset } from '@/lib/logic/password-reset-request';

export const runtime = 'nodejs';

const inputSchema = z.object({ email: z.string().trim().email().max(254) });
const unavailable = 'Password reset email is temporarily unavailable. Please try again later or contact EHS/Admin.';

function reply(body: unknown, status: number, retryAfter?: number) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) },
  });
}

export async function POST(req: Request) {
  try {
    const appUrl = PUBLIC_ENV.appUrl();
    if (process.env.NODE_ENV === 'production' && (!process.env.NEXT_PUBLIC_APP_URL || new URL(appUrl).protocol !== 'https:')) {
      throw new Error('reset_app_url_unavailable');
    }
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    const sameHost = host && (origin === `https://${host}` || origin === `http://${host}`);
    if (origin && !sameHost && origin !== new URL(req.url).origin && origin !== new URL(appUrl).origin) {
      return reply({ error: 'Request not allowed.' }, 403);
    }
    const raw = await req.text();
    if (raw.length > 2048) return reply({ error: 'Request is too large.' }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid request.' }, 400); }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return reply({ error: 'Enter a valid email address.' }, 400);

    // Check configuration even for unknown addresses, without exposing account existence.
    validateEmailConfiguration();
    const admin = createAdminClient();
    const hash = (value: string) => createHmac('sha256', SERVER_ENV.supabaseServiceRoleKey()).update(value).digest('hex');
    const result = await requestPasswordReset(parsed.data.email, appUrl, {
      claim: async (email) => {
        const { data, error } = await admin.rpc('claim_password_reset_request', {
          p_email_hash: hash(`email:${email}`), p_ip_hash: hash(`ip:${getClientIp(req)}`),
        });
        if (error || typeof data !== 'number') throw new Error('reset_rate_limit_unavailable');
        return data;
      },
      generate: async (email) => {
        const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
        if (error?.code === 'user_not_found') return null;
        if (error || !data.properties?.hashed_token || !data.user?.email) throw new Error('reset_link_generation_failed');
        return { tokenHash: data.properties.hashed_token, userId: data.user.id, email: data.user.email };
      },
      isActive: async (id) => {
        const { data, error } = await admin.from('profiles').select('is_active').eq('id', id).maybeSingle();
        if (error) throw new Error('reset_profile_lookup_failed');
        return data?.is_active === true;
      },
      send: sendEmail,
    });
    if (result.status === 429) {
      return reply({ error: 'Please wait before requesting another reset email.', retryAfter: result.retryAfter }, 429, result.retryAfter);
    }
    return reply({ ok: true, retryAfter: result.retryAfter }, 200);
  } catch (error) {
    // Never log email addresses, recovery links, or provider responses containing secrets.
    const code = error instanceof Error && /^reset_[a-z_]+$/.test(error.message) ? error.message : 'reset_unavailable';
    console.error('[password-reset]', code);
    return reply({ error: unavailable }, 503);
  }
}
