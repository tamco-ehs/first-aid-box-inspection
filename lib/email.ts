// =============================================================================
// Email helper for reminder cron. Supports Brevo (free transactional tier) and
// Resend through fetch-based APIs, so no SDK dependency is needed. API keys are
// server-only. All dynamic values are HTML-escaped before interpolation as
// defense-in-depth against injection in the email body.
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

  const brevoApiKey = SERVER_ENV.brevoApiKey();
  if (brevoApiKey) return sendBrevoEmail(brevoApiKey, opts);

  return sendResendEmail(opts);
}

function parseSender(input: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(input);
  if (m) {
    const name = m[1]?.trim();
    return { name: name || undefined, email: m[2]!.trim() };
  }
  return { email: input.trim() };
}

async function sendBrevoEmail(
  apiKey: string,
  opts: { to: string[]; subject: string; html: string; text: string },
): Promise<EmailResult> {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: parseSender(SERVER_ENV.reminderFromEmail()),
        to: opts.to.map((email) => ({ email })),
        subject: opts.subject,
        htmlContent: opts.html,
        textContent: opts.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, id: null, error: `Brevo ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { messageId?: string };
    return { ok: true, id: data.messageId ?? null };
  } catch (err) {
    return { ok: false, id: null, error: err instanceof Error ? err.message : 'send failed' };
  }
}

async function sendResendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
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

export interface TopupEmailContext {
  boxCode: string | null;
  boxName: string;
  location: string;
  inspectorName: string;
  overallStatus: string;
  boxId: string;
  items: Array<{
    itemName: string;
    priority: string;
    reason: string;
    requiredQuantity: number | null;
    observedQuantity: number | null;
    observedVolumeLevel: string | null;
    expiryDate: string | null;
  }>;
}

function inspectLink(boxId: string): string {
  return `${PUBLIC_ENV.appUrl()}/inspect/${boxId}`;
}

function adminLink(): string {
  return `${PUBLIC_ENV.appUrl()}/admin`;
}

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
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

/** Admin/EHS notification when an inspection creates new top-up requests. */
export function buildTopupEmail(ctx: TopupEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const boxLabel = ctx.boxCode ? `${ctx.boxCode} - ${ctx.boxName}` : ctx.boxName;
  const dashboardUrl = adminLink();
  const link = inspectLink(ctx.boxId);
  const itemLines = ctx.items
    .map((item) => {
      const observed = item.observedVolumeLevel ?? item.observedQuantity;
      return `- ${item.itemName}: ${item.priority} - ${item.reason} (observed: ${displayValue(observed)})`;
    })
    .join('\n');
  const subject = `Top-up required: ${boxLabel}`;
  const text =
    `A first aid inspection submitted by ${ctx.inspectorName} created ${ctx.items.length} top-up request(s).\n\n` +
    `Box: ${boxLabel}\nLocation: ${ctx.location}\nInspection status: ${ctx.overallStatus}\n\n` +
    `Items needing action:\n${itemLines}\n\n` +
    `Top-ups dashboard: ${dashboardUrl}\nInspection link: ${link}\n`;
  const rows = ctx.items
    .map((item) => {
      const observed = item.observedVolumeLevel ?? item.observedQuantity;
      return `
        <tr>
          <td style="padding:8px;border-top:1px solid #e5e7eb">${escapeHtml(item.itemName)}</td>
          <td style="padding:8px;border-top:1px solid #e5e7eb">${escapeHtml(item.priority)}</td>
          <td style="padding:8px;border-top:1px solid #e5e7eb">${escapeHtml(item.reason)}</td>
          <td style="padding:8px;border-top:1px solid #e5e7eb">${escapeHtml(displayValue(observed))}</td>
          <td style="padding:8px;border-top:1px solid #e5e7eb">${escapeHtml(displayValue(item.requiredQuantity))}</td>
          <td style="padding:8px;border-top:1px solid #e5e7eb">${escapeHtml(displayValue(item.expiryDate))}</td>
        </tr>`;
    })
    .join('');
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:680px">
      <h2 style="margin:0 0 12px;color:#b91c1c">First Aid Box Top-up Required</h2>
      <p>An inspection submitted by <strong>${escapeHtml(ctx.inspectorName)}</strong> created
         <strong>${ctx.items.length}</strong> new top-up request(s).</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#555">Box</td><td>${escapeHtml(boxLabel)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#555">Location</td><td>${escapeHtml(ctx.location)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#555">Inspection status</td><td>${escapeHtml(ctx.overallStatus)}</td></tr>
      </table>
      <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
        <thead>
          <tr style="text-align:left;background:#f9fafb">
            <th style="padding:8px">Item</th>
            <th style="padding:8px">Priority</th>
            <th style="padding:8px">Reason</th>
            <th style="padding:8px">Observed</th>
            <th style="padding:8px">Required</th>
            <th style="padding:8px">Expiry</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p>
        <a href="${escapeHtml(dashboardUrl)}"
           style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
          Open top-ups dashboard
        </a>
      </p>
      <p style="font-size:13px;color:#4b5563">Inspection link:
        <a href="${escapeHtml(link)}">${escapeHtml(link)}</a>
      </p>
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
