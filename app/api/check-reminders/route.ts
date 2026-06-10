// GET /api/check-reminders - daily reminder cron (Vercel Cron, 00:00 UTC =
// 08:00 Malaysia). Also doubles as a Supabase keep-alive query.
//
// Protected by CRON_SECRET: Vercel Cron sends "Authorization: Bearer <secret>"
// when the env var is set; any request without the exact secret is rejected.
// The secret is never returned or logged.
//
// For each active box: find the latest inspection (or fall back to created_at),
// compute days overdue, and send a reminder at the 7/14/21/28-day milestones -
// each milestone at most once (decideReminder + reminder_logs dedup). At 28
// days it also escalates to admin/EHS. Every attempt is logged.

import { timingSafeEqual } from 'node:crypto';
import { ApiError, jsonOk, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { SERVER_ENV } from '@/lib/env';
import { computeDue } from '@/lib/logic/due.ts';
import { decideReminder } from '@/lib/logic/reminder.ts';
import { buildEscalationEmail, buildReminderEmail, sendEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Admin = ReturnType<typeof createAdminClient>;

function assertCronAuth(req: Request): void {
  const provided = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${SERVER_ENV.cronSecret()}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, 'unauthorized', 'Unauthorized.');
  }
}

async function getRecipientEmails(admin: Admin, boxId: string): Promise<string[]> {
  const { data } = await admin
    .from('box_assignments')
    .select('profiles(email, is_active)')
    .eq('box_id', boxId)
    .eq('is_active', true);

  const emails: string[] = [];
  for (const row of (data ?? []) as unknown as {
    profiles: { email: string | null; is_active: boolean } | null;
  }[]) {
    const p = row.profiles;
    if (p && p.is_active && p.email) emails.push(p.email);
  }
  return [...new Set(emails)];
}

async function logReminder(
  admin: Admin,
  entry: {
    box_id: string;
    days_overdue: number;
    email_sent_to: string | null;
    status: 'sent' | 'failed';
    resend_message_id: string | null;
    error_message: string | null;
  },
): Promise<void> {
  const { error } = await admin.from('reminder_logs').insert({
    box_id: entry.box_id,
    reminder_type: 'overdue',
    days_overdue: entry.days_overdue,
    email_sent_to: entry.email_sent_to,
    status: entry.status,
    resend_message_id: entry.resend_message_id,
    error_message: entry.error_message,
  });
  if (error) console.error('[cron] reminder_logs insert failed:', error.message);
}

export async function GET(req: Request): Promise<Response> {
  return safe(async () => {
    assertCronAuth(req);

    const admin = createAdminClient();
    const now = new Date();

    // Keep-alive: a trivial query keeps the Supabase project from idling.
    const { error: keepAliveErr } = await admin.from('boxes').select('id').limit(1);

    const { data: boxesData } = await admin
      .from('boxes')
      .select('id, box_name, location_description, created_at, inspection_frequency_days')
      .eq('is_active', true);
    const boxes = (boxesData ?? []) as {
      id: string;
      box_name: string;
      location_description: string;
      created_at: string;
      inspection_frequency_days: number;
    }[];

    const fallbackEmail = SERVER_ENV.adminNotificationEmail();
    const results: Array<Record<string, unknown>> = [];

    for (const box of boxes) {
      // Latest inspection (reference date) -> due status.
      const { data: last } = await admin
        .from('inspections')
        .select('created_at')
        .eq('box_id', box.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const due = computeDue({
        lastInspectionAt: (last as { created_at: string } | null)?.created_at ?? null,
        boxCreatedAt: box.created_at,
        frequencyDays: box.inspection_frequency_days,
        now,
      });
      if (due.due_status !== 'Overdue') continue;

      // Highest milestone already sent for this box.
      const { data: sentRow } = await admin
        .from('reminder_logs')
        .select('days_overdue')
        .eq('box_id', box.id)
        .eq('reminder_type', 'overdue')
        .eq('status', 'sent')
        .order('days_overdue', { ascending: false })
        .limit(1)
        .maybeSingle();

      const decision = decideReminder(
        due.days_overdue,
        (sentRow as { days_overdue: number } | null)?.days_overdue ?? 0,
      );
      if (!decision.send) continue;

      const recipients = await getRecipientEmails(admin, box.id);
      const to = recipients.length > 0 ? recipients : fallbackEmail ? [fallbackEmail] : [];

      if (to.length === 0) {
        await logReminder(admin, {
          box_id: box.id,
          days_overdue: due.days_overdue,
          email_sent_to: null,
          status: 'failed',
          resend_message_id: null,
          error_message: 'No recipient email (no assigned first aider and no admin fallback).',
        });
        results.push({ box: box.box_name, milestone: decision.milestone, sent: false, reason: 'no_recipient' });
        continue;
      }

      const mail = buildReminderEmail({
        boxName: box.box_name,
        location: box.location_description,
        daysOverdue: due.days_overdue,
        boxId: box.id,
      });
      const sendResult = await sendEmail({
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });

      // One audit row per recipient (email_sent_to must be a single address).
      for (const addr of to) {
        await logReminder(admin, {
          box_id: box.id,
          days_overdue: due.days_overdue,
          email_sent_to: addr,
          status: sendResult.ok ? 'sent' : 'failed',
          resend_message_id: sendResult.id,
          error_message: sendResult.ok ? null : sendResult.error ?? 'send failed',
        });
      }

      // Escalate to admin/EHS at the 28-day milestone.
      let escalated = false;
      if (decision.escalate && fallbackEmail) {
        const esc = buildEscalationEmail({
          boxName: box.box_name,
          location: box.location_description,
          daysOverdue: due.days_overdue,
          boxId: box.id,
        });
        const escResult = await sendEmail({
          to: [fallbackEmail],
          subject: esc.subject,
          html: esc.html,
          text: esc.text,
        });
        await logReminder(admin, {
          box_id: box.id,
          days_overdue: due.days_overdue,
          email_sent_to: fallbackEmail,
          status: escResult.ok ? 'sent' : 'failed',
          resend_message_id: escResult.id,
          error_message: escResult.ok ? null : escResult.error ?? 'escalation send failed',
        });
        escalated = escResult.ok;
      }

      results.push({
        box: box.box_name,
        milestone: decision.milestone,
        days_overdue: due.days_overdue,
        sent: sendResult.ok,
        recipients: to.length,
        escalated,
      });
    }

    return jsonOk({
      ok: true,
      keep_alive: !keepAliveErr,
      boxes_checked: boxes.length,
      reminders_processed: results.length,
      results,
    });
  });
}
