// =============================================================================
// Resend email helper (fetch-based - no SDK dependency). The API key is
// server-only. Used by the reminder cron. All dynamic values are HTML-escaped
// before interpolation as defense-in-depth against injection in the email body.
// =============================================================================

import { PUBLIC_ENV, SERVER_ENV } from '@/lib/env';

export interface EmailResult {
  ok: boolean;
  id: string | null;
  error?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  if (opts.to.length === 0) {
    return { ok: false, id: null, error: 'No recipients.' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVER_ENV.resendApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SERVER_ENV.reminderFromEmail(),
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, id: null, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id ?? null };
  } catch (err) {
    return { ok: false, id: null, error: err instanceof Error ? err.message : 'send failed' };
  }
}

export interface ReminderContext {
  boxName: string;
  location: string;
  daysOverdue: number;
  boxId: string;
}

function inspectLink(boxId: string): string {
  return `${PUBLIC_ENV.appUrl()}/inspect/${boxId}`;
}

/** First-aider reminder email. */
export function buildReminderEmail(ctx: ReminderContext): {
  subject: string;
  html: string;
  text: string;
} {
  const link = inspectLink(ctx.boxId);
  const subject = `First Aid Box Inspection Reminder: ${ctx.boxName}`;
  const text =
    `Reminder: Your inspection for ${ctx.boxName} is overdue by ${ctx.daysOverdue} days. ` +
    `Please complete your check as soon as possible.\n\n` +
    `Box: ${ctx.boxName}\nLocation: ${ctx.location}\nDays overdue: ${ctx.daysOverdue}\n` +
    `Inspect: ${link}\n`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 12px">First Aid Box Inspection Reminder</h2>
      <p>Reminder: Your inspection for <strong>${escapeHtml(ctx.boxName)}</strong> is overdue by
         <strong>${ctx.daysOverdue} days</strong>. Please complete your check as soon as possible.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#555">Box</td><td>${escapeHtml(ctx.boxName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#555">Location</td><td>${escapeHtml(ctx.location)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#555">Days overdue</td><td>${ctx.daysOverdue}</td></tr>
      </table>
      <p><a href="${escapeHtml(link)}"
            style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
         Complete inspection</a></p>
    </div>`;
  return { subject, html, text };
}

/** Escalation email to admin/EHS at the 28-day milestone. */
export function buildEscalationEmail(ctx: ReminderContext): {
  subject: string;
  html: string;
  text: string;
} {
  const link = inspectLink(ctx.boxId);
  const subject = `ESCALATION - First Aid Box overdue ${ctx.daysOverdue} days: ${ctx.boxName}`;
  const text =
    `Escalation: ${ctx.boxName} (${ctx.location}) has been overdue for ${ctx.daysOverdue} days ` +
    `without an inspection. Please follow up with the assigned first aider.\n\nInspect: ${link}\n`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 12px;color:#b91c1c">First Aid Box Overdue - Escalation</h2>
      <p><strong>${escapeHtml(ctx.boxName)}</strong> (${escapeHtml(ctx.location)}) has been overdue for
         <strong>${ctx.daysOverdue} days</strong> with no completed inspection.</p>
      <p>Please follow up with the assigned first aider or reassign the box.</p>
      <p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
    </div>`;
  return { subject, html, text };
}

export interface ReminderSummaryItem {
  title: string;
  boxName: string;
  location: string;
  status: string;
  detail: string;
  link: string;
}

export interface ActionSummaryItem {
  actionCode: string;
  actionType: string;
  boxName: string;
  location: string;
  itemName: string | null;
  priority: string | null;
  link: string;
}

function listHtml(items: ReminderSummaryItem[]): string {
  return `
    <ul style="padding-left:18px">
      ${items
        .map(
          (item) => `
            <li style="margin:0 0 12px">
              <strong>${escapeHtml(item.title)}</strong><br/>
              <span>${escapeHtml(item.boxName)} - ${escapeHtml(item.location)}</span><br/>
              <span>Status: ${escapeHtml(item.status)}</span><br/>
              <span>${escapeHtml(item.detail)}</span><br/>
              <a href="${escapeHtml(item.link)}">${escapeHtml(item.link)}</a>
            </li>`,
        )
        .join('')}
    </ul>`;
}

function listText(items: ReminderSummaryItem[]): string {
  return items
    .map(
      (item, index) =>
        `${index + 1}. ${item.title}\n` +
        `   Box: ${item.boxName}\n` +
        `   Location: ${item.location}\n` +
        `   Status: ${item.status}\n` +
        `   ${item.detail}\n` +
        `   Link: ${item.link}`,
    )
    .join('\n\n');
}

export function buildAssignedReminderSummaryEmail(ctx: {
  recipientName: string | null;
  items: ReminderSummaryItem[];
}): { subject: string; html: string; text: string } {
  const subject = `First Aid reminders: ${ctx.items.length} item${ctx.items.length === 1 ? '' : 's'} need attention`;
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi,';
  const text =
    `${greeting}\n\nThe following assigned first aid checks are almost due or already due:\n\n` +
    `${listText(ctx.items)}\n`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2 style="margin:0 0 12px">First Aid reminders</h2>
      <p>${escapeHtml(greeting)}</p>
      <p>The following assigned first aid checks are almost due or already due:</p>
      ${listHtml(ctx.items)}
    </div>`;
  return { subject, html, text };
}

export function buildAdminDueSummaryEmail(ctx: {
  items: ReminderSummaryItem[];
}): { subject: string; html: string; text: string } {
  const subject = `First Aid due summary: ${ctx.items.length} inspection/item reminder${ctx.items.length === 1 ? '' : 's'}`;
  const text =
    `Admin summary: the following inspections or items are almost due or already due:\n\n` +
    `${listText(ctx.items)}\n`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2 style="margin:0 0 12px">First Aid due summary</h2>
      <p>The following inspections or items are almost due or already due:</p>
      ${listHtml(ctx.items)}
    </div>`;
  return { subject, html, text };
}

export function buildAdminActionSummaryEmail(ctx: {
  actions: ActionSummaryItem[];
}): { subject: string; html: string; text: string } {
  const subject = `First Aid action summary: ${ctx.actions.length} required action${ctx.actions.length === 1 ? '' : 's'}`;
  const text =
    `Admin summary: the following required action items are open or in progress:\n\n` +
    ctx.actions
      .map(
        (action, index) =>
          `${index + 1}. ${action.actionType}${action.itemName ? ` - ${action.itemName}` : ''}\n` +
          `   Code: ${action.actionCode}\n` +
          `   Box: ${action.boxName}\n` +
          `   Location: ${action.location}\n` +
          `   Priority: ${action.priority ?? 'Not set'}\n` +
          `   Link: ${action.link}`,
      )
      .join('\n\n') +
    '\n';
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:680px">
      <h2 style="margin:0 0 12px">First Aid required action summary</h2>
      <p>The following required action items are open or in progress:</p>
      <ul style="padding-left:18px">
        ${ctx.actions
          .map(
            (action) => `
              <li style="margin:0 0 12px">
                <strong>${escapeHtml(action.actionType)}${action.itemName ? ` - ${escapeHtml(action.itemName)}` : ''}</strong><br/>
                <span>Code: ${escapeHtml(action.actionCode)}</span><br/>
                <span>${escapeHtml(action.boxName)} - ${escapeHtml(action.location)}</span><br/>
                <span>Priority: ${escapeHtml(action.priority ?? 'Not set')}</span><br/>
                <a href="${escapeHtml(action.link)}">${escapeHtml(action.link)}</a>
              </li>`,
          )
          .join('')}
      </ul>
    </div>`;
  return { subject, html, text };
}
