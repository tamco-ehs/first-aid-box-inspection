// =============================================================================
// Email helper (fetch-based - no SDK dependency). Supports Brevo and Resend,
// with server-only API keys. Used by the reminder cron. All dynamic values are
// HTML-escaped before interpolation as defense-in-depth against injection in the
// email body.
// =============================================================================

import { PUBLIC_ENV, SERVER_ENV } from '@/lib/env';

export interface EmailResult {
  ok: boolean;
  id: string | null;
  error?: string;
}

type Tone = 'green' | 'red' | 'amber' | 'blue';

const tones: Record<Tone, { fg: string; bg: string; border: string }> = {
  green: { fg: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  red: { fg: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  amber: { fg: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  blue: { fg: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
};

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

  const provider = SERVER_ENV.emailProvider();
  return provider === 'brevo' ? sendBrevoEmail(opts) : sendResendEmail(opts);
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

async function sendBrevoEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': SERVER_ENV.brevoApiKey(),
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

function parseSender(value: string): { email: string; name?: string } {
  const cleaned = stripOuterQuotes(value.trim());
  const match = cleaned.match(/^(.*?)\s*<([^<>]+)>$/);
  if (!match) return { email: cleaned };

  const email = match[2]?.trim() ?? cleaned;
  const rawName = stripOuterQuotes((match[1] ?? '').trim());
  return {
    email,
    ...(rawName ? { name: rawName } : {}),
  };
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export interface ReminderContext {
  boxName: string;
  location: string;
  daysOverdue: number;
  boxId: string;
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

function inspectLink(boxId: string): string {
  return `${PUBLIC_ENV.appUrl()}/inspect/${boxId}`;
}

function emailShell(ctx: {
  title: string;
  preheader: string;
  introHtml: string;
  bodyHtml: string;
  tone?: Tone;
  ctaHref?: string;
  ctaLabel?: string;
}): string {
  const tone = tones[ctx.tone ?? 'green'];
  const cta =
    ctx.ctaHref && ctx.ctaLabel
      ? `<p style="margin:24px 0 0">
          <a href="${escapeHtml(ctx.ctaHref)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 18px">
            ${escapeHtml(ctx.ctaLabel)}
          </a>
        </p>`
      : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${escapeHtml(ctx.preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #dbe5ef;border-radius:12px;overflow:hidden">
            <tr>
              <td style="padding:22px 24px;border-top:5px solid ${tone.fg}">
                <p style="margin:0 0 8px;color:#475569;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">First Aid Box Inspection</p>
                <h1 style="margin:0;color:#0f172a;font-size:22px;line-height:1.3">${escapeHtml(ctx.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px">
                <div style="border:1px solid ${tone.border};background:${tone.bg};border-radius:10px;padding:14px 16px;margin-bottom:18px;color:${tone.fg};font-size:14px;line-height:1.5">
                  ${ctx.introHtml}
                </div>
                ${ctx.bodyHtml}
                ${cta}
                <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.5">
                  This is an automated reminder from the First Aid Box Inspection System.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function detailTableHtml(rows: Array<{ label: string; value: string | number | null | undefined }>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
    ${rows
      .map(
        (row) => `<tr>
          <td style="width:34%;padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:13px;font-weight:700">${escapeHtml(row.label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px">${escapeHtml(String(row.value ?? 'Not set'))}</td>
        </tr>`,
      )
      .join('')}
  </table>`;
}

function badgeHtml(label: string, tone: Tone): string {
  const t = tones[tone];
  return `<span style="display:inline-block;border:1px solid ${t.border};background:${t.bg};color:${t.fg};font-size:11px;font-weight:700;border-radius:999px;padding:3px 8px">${escapeHtml(label)}</span>`;
}

function statusTone(status: string): Tone {
  const normalized = status.toLowerCase();
  if (normalized.includes('overdue') || normalized.includes('expired')) return 'red';
  if (normalized.includes('today') || normalized.includes('due in') || normalized.includes('expires in')) return 'amber';
  return 'blue';
}

/** First-aider single inspection reminder email. */
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
  const html = emailShell({
    title: 'Inspection overdue',
    preheader: `${ctx.boxName} is overdue by ${ctx.daysOverdue} days.`,
    tone: 'red',
    introHtml: `Your inspection for <strong>${escapeHtml(ctx.boxName)}</strong> is overdue by <strong>${ctx.daysOverdue} day${ctx.daysOverdue === 1 ? '' : 's'}</strong>.`,
    bodyHtml: detailTableHtml([
      { label: 'Box', value: ctx.boxName },
      { label: 'Location', value: ctx.location },
      { label: 'Days overdue', value: ctx.daysOverdue },
    ]),
    ctaHref: link,
    ctaLabel: 'Complete inspection',
  });
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
  const html = emailShell({
    title: 'Inspection escalation',
    preheader: `${ctx.boxName} has been overdue for ${ctx.daysOverdue} days.`,
    tone: 'red',
    introHtml: `<strong>${escapeHtml(ctx.boxName)}</strong> has been overdue for <strong>${ctx.daysOverdue} day${ctx.daysOverdue === 1 ? '' : 's'}</strong>. Please follow up with the assigned First Aider or reassign the box.`,
    bodyHtml: detailTableHtml([
      { label: 'Box', value: ctx.boxName },
      { label: 'Location', value: ctx.location },
      { label: 'Days overdue', value: ctx.daysOverdue },
    ]),
    ctaHref: link,
    ctaLabel: 'Open inspection',
  });
  return { subject, html, text };
}

function listHtml(items: ReminderSummaryItem[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px">
    ${items
      .map(
        (item) => `<tr>
          <td style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#ffffff">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:15px;font-weight:700;color:#0f172a">${escapeHtml(item.title)}</td>
                <td align="right">${badgeHtml(item.status, statusTone(item.status))}</td>
              </tr>
            </table>
            <p style="margin:6px 0 0;color:#334155;font-size:13px">${escapeHtml(item.boxName)}</p>
            <p style="margin:2px 0 8px;color:#64748b;font-size:12px">${escapeHtml(item.location)}</p>
            <p style="margin:0 0 8px;color:#334155;font-size:13px">${escapeHtml(item.detail)}</p>
            <a href="${escapeHtml(item.link)}" style="color:#16a34a;font-size:13px;font-weight:700;text-decoration:none">Open item</a>
          </td>
        </tr>`,
      )
      .join('')}
  </table>`;
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

function actionListHtml(actions: ActionSummaryItem[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px">
    ${actions
      .map((action) => {
        const title = `${action.actionType}${action.itemName ? ` - ${action.itemName}` : ''}`;
        return `<tr>
          <td style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#ffffff">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:15px;font-weight:700;color:#0f172a">${escapeHtml(title)}</td>
                <td align="right">${badgeHtml(action.priority ?? 'Priority not set', action.priority === 'High' ? 'red' : 'amber')}</td>
              </tr>
            </table>
            <p style="margin:6px 0 0;color:#334155;font-size:13px">Code: ${escapeHtml(action.actionCode)}</p>
            <p style="margin:2px 0 0;color:#334155;font-size:13px">${escapeHtml(action.boxName)}</p>
            <p style="margin:2px 0 8px;color:#64748b;font-size:12px">${escapeHtml(action.location)}</p>
            <a href="${escapeHtml(action.link)}" style="color:#16a34a;font-size:13px;font-weight:700;text-decoration:none">Open action</a>
          </td>
        </tr>`;
      })
      .join('')}
  </table>`;
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
  const html = emailShell({
    title: 'Assigned reminders',
    preheader: `${ctx.items.length} assigned first aid check${ctx.items.length === 1 ? '' : 's'} need attention.`,
    tone: 'amber',
    introHtml: `${escapeHtml(greeting)}<br/>The following assigned first aid checks are almost due or already due.`,
    bodyHtml: listHtml(ctx.items),
    ctaHref: ctx.items[0]?.link,
    ctaLabel: 'Open first item',
  });
  return { subject, html, text };
}

export function buildAdminDueSummaryEmail(ctx: {
  items: ReminderSummaryItem[];
}): { subject: string; html: string; text: string } {
  const subject = `First Aid due summary: ${ctx.items.length} inspection/item reminder${ctx.items.length === 1 ? '' : 's'}`;
  const text =
    `Admin summary: the following inspections or items are almost due or already due:\n\n` +
    `${listText(ctx.items)}\n`;
  const html = emailShell({
    title: 'Admin due summary',
    preheader: `${ctx.items.length} inspection or item reminder${ctx.items.length === 1 ? '' : 's'} need attention.`,
    tone: 'amber',
    introHtml: `The following inspections or items are almost due or already due across all active boxes.`,
    bodyHtml: listHtml(ctx.items),
    ctaHref: `${PUBLIC_ENV.appUrl()}/reports`,
    ctaLabel: 'Open dashboard',
  });
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
  const html = emailShell({
    title: 'Required action summary',
    preheader: `${ctx.actions.length} required action${ctx.actions.length === 1 ? '' : 's'} are open or in progress.`,
    tone: 'red',
    introHtml: `The following required action items are open or in progress. They are consolidated into this single admin email.`,
    bodyHtml: actionListHtml(ctx.actions),
    ctaHref: `${PUBLIC_ENV.appUrl()}/actions`,
    ctaLabel: 'Open actions',
  });
  return { subject, html, text };
}
