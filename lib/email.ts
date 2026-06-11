// =============================================================================
// Email helper for reminder cron. Supports Brevo (free transactional tier) and
// Resend through fetch-based APIs, so no SDK dependency is needed. API keys are
// server-only. All dynamic values are HTML-escaped before interpolation as
// defense-in-depth against injection in the email body.
// =============================================================================

import { PUBLIC_ENV, SERVER_ENV } from '@/lib/env';
import { deriveRequiredAction, groupActionItemsForAdmin, type ActionLine } from '@/lib/logic/action.ts';
import type { ActionType, EvaluatedItem } from '@/lib/logic/types.ts';

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

export interface ActionEmailContext {
  boxCode: string | null;
  boxName: string;
  location: string;
  inspectorName: string;
  overallStatus: string;
  submittedAt: string | null;
  boxId: string;
  lines: ActionLine[];
}

function inspectLink(boxId: string): string {
  return `${PUBLIC_ENV.appUrl()}/inspect/${boxId}`;
}

function dashboardLink(): string {
  // The action dashboard (Phase 2 enhances /reports with ?tab=actions filters).
  return `${PUBLIC_ENV.appUrl()}/reports`;
}

const EMAIL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]} ${EMAIL_MONTHS[Number(m[2]) - 1] ?? '?'} ${m[1]}` : iso;
}
function observedText(ev: EvaluatedItem, unit: string | null): string {
  if (ev.measurement_type === 'quantity') return `${ev.observed_quantity ?? '-'}${unit ? ` ${unit}` : ''}`;
  if (ev.measurement_type === 'volume_level') return ev.observed_volume_level ?? '-';
  return ev.observed_present_status ?? '-';
}
function requiredText(ev: EvaluatedItem, unit: string | null): string {
  if (ev.measurement_type === 'quantity') return `${ev.required_quantity ?? '-'}${unit ? ` ${unit}` : ''}`;
  return '-';
}
function expiryText(ev: EvaluatedItem): string {
  if (ev.expiry_state === 'not_required') return 'Not applicable';
  const d = ev.expiry_date ?? ev.system_expiry_date;
  return d ? fmtDate(d) : 'Not recorded';
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

/**
 * Admin/EHS notification after an inspection. Groups ALL action items (not just
 * top-ups) into scannable, mobile-friendly sections with a clear required action
 * per item, summary counts, and an action-dashboard button at top and bottom.
 */
export function buildActionEmail(ctx: ActionEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const boxLabel = ctx.boxCode ? `${ctx.boxCode} - ${ctx.boxName}` : ctx.boxName;
  const shortLabel = ctx.boxCode ?? ctx.boxName;
  const dashboardUrl = dashboardLink();
  const link = inspectLink(ctx.boxId);
  const sections = groupActionItemsForAdmin(ctx.lines);
  const total = ctx.lines.length;

  const count = (t: ActionType) => ctx.lines.filter((l) => l.ev.action_type === t).length;
  const immediate = count('immediate_action');
  const replacement = count('replacement_required');
  const topup = count('topup_required');
  const expiring = count('expiring_soon');
  const verification = count('expiry_verification_required');
  const baseline = count('expiry_baseline_missing');
  const adminReview = count('admin_review_required');
  const hasExpired = ctx.lines.some((l) => l.ev.is_expired);

  let subject: string;
  if (hasExpired || immediate > 0) {
    subject = `[Urgent First Aid Action] ${shortLabel}: ${hasExpired ? 'Expired item found' : 'Immediate action required'}`;
  } else {
    const parts: string[] = [];
    if (topup) parts.push(`${topup} top-up`);
    if (replacement) parts.push(`${replacement} replace`);
    if (expiring) parts.push(`${expiring} expiring`);
    if (verification) parts.push(`${verification} expiry check${verification === 1 ? '' : 's'}`);
    if (baseline) parts.push(`${baseline} baseline`);
    if (adminReview) parts.push(`${adminReview} review`);
    subject = `[First Aid Action] ${shortLabel}: ${parts.join(', ') || 'Action required'}`;
  }

  const summaryRows: [string, number][] = (
    [
      ['Immediate action', immediate],
      ['Top-up required', topup],
      ['Replacement required', replacement],
      ['Expiring soon', expiring],
      ['Expiry verification', verification],
      ['Expiry baseline missing', baseline],
      ['Admin review', adminReview],
    ] as [string, number][]
  ).filter(([, n]) => n > 0);

  const text =
    `First aid inspection by ${ctx.inspectorName} created ${total} action item(s).\n\n` +
    `Box: ${boxLabel}\nLocation: ${ctx.location}\nInspection status: ${ctx.overallStatus}\n` +
    (ctx.submittedAt ? `Submitted: ${ctx.submittedAt}\n` : '') +
    '\n' +
    sections
      .map(
        (s) =>
          `${s.title}:\n` +
          s.lines
            .map(
              (l) =>
                `  - ${l.ev.item_name} [${l.ev.priority}] - ${deriveRequiredAction(l.ev, l.unit)} ` +
                `(observed ${observedText(l.ev, l.unit)}` +
                `${l.ev.measurement_type === 'quantity' ? `, required ${requiredText(l.ev, l.unit)}` : ''})`,
            )
            .join('\n'),
      )
      .join('\n\n') +
    `\n\nAction dashboard: ${dashboardUrl}\nInspection record: ${link}\n`;

  const CAP = 10;
  let shown = 0;
  const sectionHtml: string[] = [];
  for (const s of sections) {
    if (shown >= CAP) break;
    const cards: string[] = [];
    for (const l of s.lines) {
      if (shown >= CAP) break;
      shown += 1;
      const ev = l.ev;
      cards.push(`
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin:8px 0">
          <div style="font-weight:600">${escapeHtml(ev.item_name)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px">Priority: ${escapeHtml(ev.priority)}${ev.is_critical ? ' &middot; Critical' : ''}</div>
          <div style="font-size:13px;margin-top:4px">Issue: ${escapeHtml(ev.reason)}</div>
          <div style="font-size:13px;margin-top:2px">Observed: ${escapeHtml(observedText(ev, l.unit))}${
            ev.measurement_type === 'quantity' ? ` &middot; Required: ${escapeHtml(requiredText(ev, l.unit))}` : ''
          }</div>
          <div style="font-size:13px;margin-top:2px">Expiry: ${escapeHtml(expiryText(ev))}</div>
          <div style="font-size:13px;font-weight:600;color:#b91c1c;margin-top:4px">Required action: ${escapeHtml(deriveRequiredAction(ev, l.unit))}</div>
        </div>`);
    }
    sectionHtml.push(`<h3 style="margin:16px 0 4px;font-size:15px">${escapeHtml(s.title)}</h3>${cards.join('')}`);
  }
  const truncated = total > shown;

  const dashboardButton = `
    <p style="margin:14px 0">
      <a href="${escapeHtml(dashboardUrl)}" style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
        Open action dashboard</a>
    </p>`;

  const summaryHtml = summaryRows
    .map(
      ([label, n]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#555">${escapeHtml(label)}</td><td style="font-weight:600">${n}</td></tr>`,
    )
    .join('');

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:620px">
      <h2 style="margin:0 0 4px;color:#b91c1c">First Aid Box Action Required</h2>
      <p style="margin:0 0 12px;color:#374151"><strong>${escapeHtml(ctx.inspectorName)}</strong> submitted an inspection that created <strong>${total}</strong> action item(s).</p>
      <table style="border-collapse:collapse;margin:0 0 8px;font-size:14px">
        <tr><td style="padding:2px 12px 2px 0;color:#555">Box</td><td>${escapeHtml(boxLabel)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555">Location</td><td>${escapeHtml(ctx.location)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555">Inspected by</td><td>${escapeHtml(ctx.inspectorName)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555">Status</td><td>${escapeHtml(ctx.overallStatus)}</td></tr>
        ${ctx.submittedAt ? `<tr><td style="padding:2px 12px 2px 0;color:#555">Submitted</td><td>${escapeHtml(ctx.submittedAt)}</td></tr>` : ''}
      </table>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin:8px 0">
        <div style="font-weight:600;margin-bottom:4px">Inspection result: Action Required</div>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:2px 12px 2px 0;color:#555">Total action items</td><td style="font-weight:600">${total}</td></tr>
          ${summaryHtml}
        </table>
      </div>
      ${dashboardButton}
      ${sectionHtml.join('')}
      ${truncated ? '<p style="font-size:13px;color:#6b7280">More action items are available in the dashboard.</p>' : ''}
      ${dashboardButton}
      <p style="font-size:13px;color:#4b5563">Inspection record: <a href="${escapeHtml(link)}">View inspection record</a></p>
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
