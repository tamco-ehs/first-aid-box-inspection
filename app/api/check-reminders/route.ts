// GET /api/check-reminders - daily reminder cron (Vercel Cron, 00:00 UTC =
// 08:00 Malaysia). Also doubles as a Supabase keep-alive query.
//
// Protected by CRON_SECRET. The route sends:
// - assigned-user summaries for inspections/items that are due soon or overdue
// - admin summaries for all due inspections/items
// - one consolidated admin action summary for open/in-progress actions
//
// reminder_logs.reminder_key + cycle_key prevent duplicate notifications for
// the same box, item, or action within the same Malaysia-date reminder cycle.

import { timingSafeEqual } from 'node:crypto';
import { ApiError, jsonOk, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_ENV, SERVER_ENV } from '@/lib/env';
import { computeDue } from '@/lib/logic/due.ts';
import {
  buildAdminActionSummaryEmail,
  buildAdminDueSummaryEmail,
  buildAssignedReminderSummaryEmail,
  sendEmail,
  type ActionSummaryItem,
  type ReminderSummaryItem,
} from '@/lib/email';
import { ensureExpiredItemActions } from '@/lib/server/expired-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Admin = ReturnType<typeof createAdminClient>;
type ReminderType =
  | 'inspection_due_soon'
  | 'inspection_overdue'
  | 'item_due_soon'
  | 'item_overdue'
  | 'action_required';

interface Recipient {
  id: string | null;
  fullName: string | null;
  email: string;
}

interface BoxRow {
  id: string;
  box_code: string;
  box_name: string;
  location_description: string;
  area: string | null;
  created_at: string;
  inspection_frequency_days: number;
}

interface ReminderEntry extends ReminderSummaryItem {
  boxId: string;
  reminderType: ReminderType;
  reminderKey: string;
  daysOverdue: number;
}

interface ActionEntry extends ActionSummaryItem {
  id: string;
  boxId: string;
  reminderType: 'action_required';
  reminderKey: string;
}

function assertCronAuth(req: Request): void {
  const provided = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${SERVER_ENV.cronSecret()}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, 'unauthorized', 'Unauthorized.');
  }
}

function appLink(path: string): string {
  return `${PUBLIC_ENV.appUrl()}${path}`;
}

function malaysiaCycleKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dayDiff(fromIsoDate: string, now: Date): number {
  const from = new Date(`${fromIsoDate.slice(0, 10)}T00:00:00Z`).getTime();
  const current = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.ceil((from - current) / 86_400_000);
}

function locationOf(box: Pick<BoxRow, 'location_description' | 'area'>): string {
  return [box.location_description, box.area].filter(Boolean).join(' - ');
}

function boxLabel(box: Pick<BoxRow, 'box_code' | 'box_name'>): string {
  return `${box.box_code} - ${box.box_name}`;
}

async function getSentSet(admin: Admin, cycleKey: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from('reminder_logs')
    .select('reminder_type, reminder_key, email_sent_to')
    .eq('cycle_key', cycleKey)
    .eq('status', 'sent');
  if (error) {
    console.error('[cron] reminder log lookup failed:', error.message);
    return new Set();
  }
  return new Set(
    ((data ?? []) as { reminder_type: string; reminder_key: string | null; email_sent_to: string | null }[])
      .filter((row) => row.reminder_key && row.email_sent_to)
      .map((row) => sentKey(row.reminder_type, row.reminder_key as string, row.email_sent_to as string)),
  );
}

function sentKey(reminderType: string, reminderKey: string, email: string): string {
  return `${reminderType}|${reminderKey}|${email.toLowerCase()}`;
}

async function logReminder(
  admin: Admin,
  entry: {
    boxId: string;
    reminderType: ReminderType;
    reminderKey: string;
    cycleKey: string;
    daysOverdue: number;
    emailSentTo: string | null;
    status: 'sent' | 'failed';
    resendMessageId: string | null;
    errorMessage: string | null;
  },
): Promise<void> {
  const { error } = await admin.from('reminder_logs').insert({
    box_id: entry.boxId,
    reminder_type: entry.reminderType,
    reminder_key: entry.reminderKey,
    cycle_key: entry.cycleKey,
    days_overdue: entry.daysOverdue,
    email_sent_to: entry.emailSentTo,
    status: entry.status,
    resend_message_id: entry.resendMessageId,
    error_message: entry.errorMessage,
  });
  if (error) console.error('[cron] reminder_logs insert failed:', error.message);
}

async function getAdminRecipients(admin: Admin): Promise<Recipient[]> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .eq('is_active', true)
    .in('role', ['superadmin', 'admin'])
    .not('email', 'is', null);
  if (error) {
    console.error('[cron] admin recipient lookup failed:', error.message);
  }
  const recipients = ((data ?? []) as { id: string; full_name: string; email: string | null }[])
    .filter((row): row is { id: string; full_name: string; email: string } => Boolean(row.email))
    .map((row) => ({ id: row.id, fullName: row.full_name, email: row.email }));

  if (recipients.length > 0) return dedupeRecipients(recipients);

  const fallback = SERVER_ENV.adminNotificationEmail();
  return fallback ? [{ id: null, fullName: 'Admin', email: fallback }] : [];
}

async function getAssignments(admin: Admin): Promise<Map<string, Recipient[]>> {
  const { data, error } = await admin
    .from('box_assignments')
    .select('box_id, profiles!box_assignments_profile_id_fkey(id, full_name, email, is_active, role)')
    .eq('is_active', true);
  if (error) {
    console.error('[cron] assignment lookup failed:', error.message);
    return new Map();
  }

  const byBox = new Map<string, Recipient[]>();
  for (const row of (data ?? []) as unknown as {
    box_id: string;
    profiles: { id: string; full_name: string; email: string | null; is_active: boolean; role: string } | null;
  }[]) {
    const profile = row.profiles;
    if (!profile?.is_active || profile.role !== 'user' || !profile.email) continue;
    const list = byBox.get(row.box_id) ?? [];
    list.push({ id: profile.id, fullName: profile.full_name, email: profile.email });
    byBox.set(row.box_id, list);
  }

  for (const [boxId, recipients] of byBox) byBox.set(boxId, dedupeRecipients(recipients));
  return byBox;
}

function dedupeRecipients(recipients: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const result: Recipient[] = [];
  for (const recipient of recipients) {
    const key = recipient.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(recipient);
  }
  return result;
}

async function buildInspectionEntries(admin: Admin, boxes: BoxRow[], now: Date): Promise<ReminderEntry[]> {
  const { data: inspectionsData } = await admin
    .from('inspections')
    .select('box_id, created_at')
    .order('created_at', { ascending: false });
  const latestByBox = new Map<string, string>();
  for (const row of (inspectionsData ?? []) as { box_id: string; created_at: string }[]) {
    if (!latestByBox.has(row.box_id)) latestByBox.set(row.box_id, row.created_at);
  }

  const entries: ReminderEntry[] = [];
  for (const box of boxes) {
    const due = computeDue({
      lastInspectionAt: latestByBox.get(box.id) ?? null,
      boxCreatedAt: box.created_at,
      frequencyDays: box.inspection_frequency_days,
      now,
    });
    const daysUntilDue = dayDiff(due.next_due_date, now);
    const isOverdue = due.days_overdue > 0;
    const isDueSoon = !isOverdue && daysUntilDue >= 0 && daysUntilDue <= 7;
    if (!isOverdue && !isDueSoon) continue;

    entries.push({
      boxId: box.id,
      reminderType: isOverdue ? 'inspection_overdue' : 'inspection_due_soon',
      reminderKey: `inspection:${box.id}`,
      daysOverdue: isOverdue ? due.days_overdue : -daysUntilDue,
      title: 'Inspection check',
      boxName: boxLabel(box),
      location: locationOf(box),
      status: isOverdue ? 'Overdue' : daysUntilDue === 0 ? 'Due today' : `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`,
      detail: isOverdue
        ? `Inspection is overdue by ${due.days_overdue} day${due.days_overdue === 1 ? '' : 's'}.`
        : `Inspection due date is ${due.next_due_date.slice(0, 10)}.`,
      link: appLink(`/inspect/${box.id}`),
    });
  }
  return entries;
}

async function buildItemEntries(admin: Admin, boxesById: Map<string, BoxRow>, now: Date): Promise<ReminderEntry[]> {
  const { data, error } = await admin
    .from('box_items_effective')
    .select('id, box_id, item_name, expiry_date, expiry_warning_days, has_expiry, is_active')
    .eq('is_active', true)
    .eq('has_expiry', true)
    .not('expiry_date', 'is', null);
  if (error) {
    console.error('[cron] item reminder lookup failed:', error.message);
    return [];
  }

  const entries: ReminderEntry[] = [];
  for (const item of (data ?? []) as {
    id: string;
    box_id: string;
    item_name: string;
    expiry_date: string | null;
    expiry_warning_days: number | null;
    has_expiry: boolean;
    is_active: boolean;
  }[]) {
    if (!item.expiry_date) continue;
    const box = boxesById.get(item.box_id);
    if (!box) continue;
    const daysUntilExpiry = dayDiff(item.expiry_date, now);
    const warningDays = item.expiry_warning_days ?? 30;
    const isExpired = daysUntilExpiry < 0;
    const isDueSoon = !isExpired && daysUntilExpiry <= warningDays;
    if (!isExpired && !isDueSoon) continue;

    entries.push({
      boxId: item.box_id,
      reminderType: isExpired ? 'item_overdue' : 'item_due_soon',
      reminderKey: `item:${item.id}`,
      daysOverdue: isExpired ? Math.abs(daysUntilExpiry) : -daysUntilExpiry,
      title: item.item_name,
      boxName: boxLabel(box),
      location: locationOf(box),
      status: isExpired ? 'Expired' : daysUntilExpiry === 0 ? 'Expires today' : `Expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`,
      detail: `Expiry date: ${item.expiry_date}`,
      link: appLink('/admin?tab=expiring-items'),
    });
  }
  return entries;
}

async function buildActionEntries(admin: Admin, boxesById: Map<string, BoxRow>): Promise<ActionEntry[]> {
  const { data, error } = await admin
    .from('actions')
    .select('id, action_code, box_id, action_type, item_name, priority, status')
    .in('status', ['Open', 'In Progress'])
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('[cron] action reminder lookup failed:', error.message);
    return [];
  }

  return ((data ?? []) as {
    id: string;
    action_code: string;
    box_id: string;
    action_type: string;
    item_name: string | null;
    priority: string | null;
    status: string;
  }[])
    .map((action) => {
      const box = boxesById.get(action.box_id);
      if (!box) return null;
      return {
        id: action.id,
        boxId: action.box_id,
        reminderType: 'action_required' as const,
        reminderKey: `action:${action.id}`,
        actionCode: action.action_code,
        actionType: action.action_type,
        boxName: boxLabel(box),
        location: locationOf(box),
        itemName: action.item_name,
        priority: action.priority,
        link: appLink(`/actions/${action.id}`),
      };
    })
    .filter((entry): entry is ActionEntry => Boolean(entry));
}

async function sendDueSummary(
  admin: Admin,
  recipient: Recipient,
  entries: ReminderEntry[],
  cycleKey: string,
  sent: Set<string>,
  adminSummary: boolean,
): Promise<{ sent: boolean; count: number }> {
  const pending = entries.filter((entry) => !sent.has(sentKey(entry.reminderType, entry.reminderKey, recipient.email)));
  if (pending.length === 0) return { sent: false, count: 0 };

  const mail = adminSummary
    ? buildAdminDueSummaryEmail({ items: pending })
    : buildAssignedReminderSummaryEmail({ recipientName: recipient.fullName, items: pending });
  const result = await sendEmail({ to: [recipient.email], subject: mail.subject, html: mail.html, text: mail.text });

  for (const entry of pending) {
    await logReminder(admin, {
      boxId: entry.boxId,
      reminderType: entry.reminderType,
      reminderKey: entry.reminderKey,
      cycleKey,
      daysOverdue: entry.daysOverdue,
      emailSentTo: recipient.email,
      status: result.ok ? 'sent' : 'failed',
      resendMessageId: result.id,
      errorMessage: result.ok ? null : result.error ?? 'send failed',
    });
    if (result.ok) sent.add(sentKey(entry.reminderType, entry.reminderKey, recipient.email));
  }

  return { sent: result.ok, count: pending.length };
}

async function sendActionSummary(
  admin: Admin,
  recipient: Recipient,
  entries: ActionEntry[],
  cycleKey: string,
  sent: Set<string>,
): Promise<{ sent: boolean; count: number }> {
  const pending = entries.filter((entry) => !sent.has(sentKey(entry.reminderType, entry.reminderKey, recipient.email)));
  if (pending.length === 0) return { sent: false, count: 0 };

  const mail = buildAdminActionSummaryEmail({ actions: pending });
  const result = await sendEmail({ to: [recipient.email], subject: mail.subject, html: mail.html, text: mail.text });

  for (const entry of pending) {
    await logReminder(admin, {
      boxId: entry.boxId,
      reminderType: entry.reminderType,
      reminderKey: entry.reminderKey,
      cycleKey,
      daysOverdue: 0,
      emailSentTo: recipient.email,
      status: result.ok ? 'sent' : 'failed',
      resendMessageId: result.id,
      errorMessage: result.ok ? null : result.error ?? 'send failed',
    });
    if (result.ok) sent.add(sentKey(entry.reminderType, entry.reminderKey, recipient.email));
  }

  return { sent: result.ok, count: pending.length };
}

export async function GET(req: Request): Promise<Response> {
  return safe(async () => {
    assertCronAuth(req);

    const admin = createAdminClient();
    const now = new Date();
    const cycleKey = malaysiaCycleKey(now);

    const { error: keepAliveErr } = await admin.from('boxes').select('id').limit(1);
    await ensureExpiredItemActions(admin);

    const { data: boxesData } = await admin
      .from('boxes')
      .select('id, box_code, box_name, location_description, area, created_at, inspection_frequency_days')
      .eq('is_active', true);
    const boxes = (boxesData ?? []) as BoxRow[];
    const boxesById = new Map(boxes.map((box) => [box.id, box]));

    const [assignments, adminRecipients, inspectionEntries, itemEntries, actionEntries] = await Promise.all([
      getAssignments(admin),
      getAdminRecipients(admin),
      buildInspectionEntries(admin, boxes, now),
      buildItemEntries(admin, boxesById, now),
      buildActionEntries(admin, boxesById),
    ]);

    const sent = await getSentSet(admin, cycleKey);
    const dueEntries = [...inspectionEntries, ...itemEntries];
    const results: Array<Record<string, unknown>> = [];

    const entriesByAssignedRecipient = new Map<string, { recipient: Recipient; entries: ReminderEntry[] }>();
    for (const entry of dueEntries) {
      for (const recipient of assignments.get(entry.boxId) ?? []) {
        const key = recipient.email.toLowerCase();
        const current = entriesByAssignedRecipient.get(key) ?? { recipient, entries: [] };
        current.entries.push(entry);
        entriesByAssignedRecipient.set(key, current);
      }
    }

    for (const { recipient, entries } of entriesByAssignedRecipient.values()) {
      const result = await sendDueSummary(admin, recipient, entries, cycleKey, sent, false);
      results.push({ scope: 'assigned_user_due_summary', recipient: recipient.email, ...result });
    }

    for (const recipient of adminRecipients) {
      const dueResult = await sendDueSummary(admin, recipient, dueEntries, cycleKey, sent, true);
      results.push({ scope: 'admin_due_summary', recipient: recipient.email, ...dueResult });

      const actionResult = await sendActionSummary(admin, recipient, actionEntries, cycleKey, sent);
      results.push({ scope: 'admin_action_summary', recipient: recipient.email, ...actionResult });
    }

    return jsonOk({
      ok: true,
      keep_alive: !keepAliveErr,
      cycle_key: cycleKey,
      boxes_checked: boxes.length,
      inspection_reminders: inspectionEntries.length,
      item_reminders: itemEntries.length,
      action_reminders: actionEntries.length,
      recipients_checked: entriesByAssignedRecipient.size + adminRecipients.length,
      summaries_processed: results.filter((result) => result.count).length,
      results,
    });
  });
}
