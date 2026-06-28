// Admin-only helper to send sample notification emails to the current user.
// This does not write reminder_logs, so it can be used repeatedly without
// changing the real reminder cycle.

import { requireActive, requireRole } from '@/lib/auth';
import { badRequest, jsonOk, safe } from '@/lib/http';
import {
  buildAdminActionSummaryEmail,
  buildAdminDueSummaryEmail,
  buildAssignedReminderSummaryEmail,
  buildEscalationEmail,
  buildReminderEmail,
  sendEmail,
  type ActionSummaryItem,
  type ReminderSummaryItem,
} from '@/lib/email';
import { PUBLIC_ENV } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TestMessage {
  key: string;
  label: string;
  subject: string;
  html: string;
  text: string;
}

export async function POST(): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['superadmin', 'admin']);

    const recipient = ctx.email?.trim() || ctx.profile.email?.trim();
    if (!recipient) throw badRequest('Your user profile does not have an email address.');

    const messages = buildTestMessages(ctx.profile.full_name);
    const results = [];

    for (const message of messages) {
      const result = await sendEmail({
        to: [recipient],
        subject: `[TEST] ${message.subject}`,
        html: message.html,
        text: `TEST EMAIL - sample data only.\n\n${message.text}`,
      });
      results.push({
        key: message.key,
        label: message.label,
        ok: result.ok,
        id: result.id,
        error: result.error,
      });
    }

    return jsonOk({
      ok: results.every((result) => result.ok),
      recipient,
      count: results.length,
      sent: results.filter((result) => result.ok).length,
      results,
    });
  });
}

function buildTestMessages(recipientName: string | null): TestMessage[] {
  const appUrl = PUBLIC_ENV.appUrl();
  const reminders = sampleReminderItems(appUrl);
  const actions = sampleActionItems(appUrl);
  const singleReminder = buildReminderEmail({
    boxId: '00000000-0000-4000-8000-000000000001',
    boxName: 'TEST AIS-01 First Aid Box',
    location: 'New AIS Assembly - Production',
    daysOverdue: 3,
  });
  const escalation = buildEscalationEmail({
    boxId: '00000000-0000-4000-8000-000000000001',
    boxName: 'TEST AIS-01 First Aid Box',
    location: 'New AIS Assembly - Production',
    daysOverdue: 28,
  });

  return [
    {
      key: 'assigned-reminder-summary',
      label: 'Assigned first aider reminder summary',
      ...buildAssignedReminderSummaryEmail({ recipientName, items: reminders }),
    },
    {
      key: 'admin-due-summary',
      label: 'Admin due inspection and item summary',
      ...buildAdminDueSummaryEmail({ items: reminders }),
    },
    {
      key: 'admin-action-summary',
      label: 'Admin required action summary',
      ...buildAdminActionSummaryEmail({ actions }),
    },
    {
      key: 'single-inspection-reminder',
      label: 'Single inspection overdue reminder',
      ...singleReminder,
    },
    {
      key: 'single-escalation',
      label: 'Single overdue escalation',
      ...escalation,
    },
  ];
}

function sampleReminderItems(appUrl: string): ReminderSummaryItem[] {
  const today = new Date();
  const dueSoon = isoDate(addDays(today, 3));
  const expired = isoDate(addDays(today, -14));
  const expiring = isoDate(addDays(today, 7));

  return [
    {
      title: 'TEST inspection due',
      boxName: 'AIS-01 - AIS-01 First Aid Box',
      location: 'New AIS Assembly - Production',
      status: 'Due in 3 days',
      detail: `Sample inspection due date: ${dueSoon}`,
      link: `${appUrl}/my-boxes`,
    },
    {
      title: 'TEST item expired - Handyplast',
      boxName: 'AIS-01 - AIS-01 First Aid Box',
      location: 'New AIS Assembly - Production',
      status: 'Expired',
      detail: `Sample expiry date: ${expired}`,
      link: `${appUrl}/admin?tab=expiring-items`,
    },
    {
      title: 'TEST item expiring soon - Alcohol swab',
      boxName: 'OFF-01 - OFF-01 First Aid Box',
      location: 'Office 1st Floor, Near Lift - Office',
      status: 'Expires in 7 days',
      detail: `Sample expiry date: ${expiring}`,
      link: `${appUrl}/admin?tab=expiring-items`,
    },
  ];
}

function sampleActionItems(appUrl: string): ActionSummaryItem[] {
  return [
    {
      actionCode: 'FA-ACT-TEST-0001',
      actionType: 'Item Expired',
      boxName: 'AIS-01 - AIS-01 First Aid Box',
      location: 'New AIS Assembly - Production',
      itemName: 'Handyplast',
      priority: 'High',
      link: `${appUrl}/actions`,
    },
    {
      actionCode: 'FA-ACT-TEST-0002',
      actionType: 'Item Low Qty',
      boxName: 'AIS-01 - AIS-01 First Aid Box',
      location: 'New AIS Assembly - Production',
      itemName: 'Safety pin',
      priority: 'Medium',
      link: `${appUrl}/actions`,
    },
    {
      actionCode: 'FA-ACT-TEST-0003',
      actionType: 'Item Missing',
      boxName: 'OFF-01 - OFF-01 First Aid Box',
      location: 'Office 1st Floor, Near Lift - Office',
      itemName: 'Alcohol swab',
      priority: 'High',
      link: `${appUrl}/actions`,
    },
  ];
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
