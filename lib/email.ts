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
                <div style="border-left:4px solid ${tone.fg};background:#ffffff;border-radius:8px;padding:9px 12px;margin-bottom:14px;color:#334155;font-size:14px;line-height:1.45">
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

interface SummaryMetric {
  label: string;
  value: string | number;
  tone: Tone;
}

function summaryMetricsHtml(metrics: SummaryMetric[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;margin:0 0 14px">
    <tr>
      ${metrics
        .map((metric, index) => {
          const tone = tones[metric.tone];
          const padding = index === 0 ? '0 4px 0 0' : index === metrics.length - 1 ? '0 0 0 4px' : '0 4px';
          return `<td width="${Math.floor(100 / metrics.length)}%" style="padding:${padding};vertical-align:top">
            <div style="border:1px solid ${tone.border};background:${tone.bg};border-radius:10px;padding:10px 12px">
              <p style="margin:0;color:${tone.fg};font-size:20px;line-height:1;font-weight:800">${escapeHtml(String(metric.value))}</p>
              <p style="margin:5px 0 0;color:#334155;font-size:11px;font-weight:700;text-transform:uppercase">${escapeHtml(metric.label)}</p>
            </div>
          </td>`;
        })
        .join('')}
    </tr>
  </table>`;
}

function reminderMetrics(items: ReminderSummaryItem[]): SummaryMetric[] {
  const urgent = items.filter((item) => statusTone(item.status) === 'red').length;
  return [
    { label: 'Need action', value: items.length, tone: 'blue' },
    { label: 'Urgent', value: urgent, tone: urgent > 0 ? 'red' : 'green' },
    { label: 'Boxes', value: groupByBox(items).length, tone: 'amber' },
  ];
}

function actionMetrics(actions: ActionSummaryItem[]): SummaryMetric[] {
  const high = actions.filter((action) => action.priority === 'High').length;
  return [
    { label: 'Actions', value: actions.length, tone: 'blue' },
    { label: 'High', value: high, tone: high > 0 ? 'red' : 'green' },
    { label: 'Boxes', value: groupByBox(actions).length, tone: 'amber' },
  ];
}

function groupByBox<T extends { boxName: string; location: string }>(items: T[]): Array<{
  boxName: string;
  location: string;
  items: T[];
}> {
  const groups = new Map<string, { boxName: string; location: string; items: T[] }>();
  for (const item of items) {
    const key = `${item.boxName}||${item.location}`;
    const group = groups.get(key) ?? { boxName: item.boxName, location: item.location, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function orderedReminderGroups(items: ReminderSummaryItem[]): Array<{ boxName: string; location: string; items: ReminderSummaryItem[] }> {
  return groupByBox(items)
    .map((group) => ({ ...group, items: [...group.items].sort((a, b) => reminderRank(a) - reminderRank(b)) }))
    .sort((a, b) => Math.min(...a.items.map(reminderRank)) - Math.min(...b.items.map(reminderRank)));
}

function orderedActionGroups(actions: ActionSummaryItem[]): Array<{ boxName: string; location: string; items: ActionSummaryItem[] }> {
  return groupByBox(actions)
    .map((group) => ({ ...group, items: [...group.items].sort((a, b) => actionRank(a) - actionRank(b)) }))
    .sort((a, b) => Math.min(...a.items.map(actionRank)) - Math.min(...b.items.map(actionRank)));
}

function reminderRank(item: ReminderSummaryItem): number {
  const tone = statusTone(item.status);
  if (tone === 'red') return 0;
  if (tone === 'amber') return 1;
  return 2;
}

function actionRank(action: ActionSummaryItem): number {
  if (action.priority === 'High') return 0;
  if (action.priority === 'Medium') return 1;
  return 2;
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

function reminderListHtml(items: ReminderSummaryItem[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px">
    ${orderedReminderGroups(items)
      .map(
        (group) => `<tr>
          <td style="border:1px solid #dbe5ef;border-radius:12px;background:#ffffff;overflow:hidden">
            ${boxGroupHeaderHtml(group.boxName, group.location, group.items.length)}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
              ${group.items
                .map(
                  (item) => `<tr>
                    <td style="padding:10px 12px;border-top:1px solid #e2e8f0">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding-right:10px">
                            <p style="margin:0;color:#0f172a;font-size:14px;font-weight:800;line-height:1.35">${escapeHtml(cleanTitle(item.title))}</p>
                            <p style="margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.35">${escapeHtml(compactDetail(item.detail))}</p>
                          </td>
                          <td align="right" style="white-space:nowrap;vertical-align:top">
                            ${badgeHtml(shortStatus(item.status), statusTone(item.status))}
                            <p style="margin:8px 0 0"><a href="${escapeHtml(item.link)}" style="color:#16a34a;font-size:12px;font-weight:800;text-decoration:none">Open</a></p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>`,
                )
                .join('')}
            </table>
          </td>
        </tr>`,
      )
      .join('')}
  </table>`;
}

function boxGroupHeaderHtml(boxName: string, location: string, count: number): string {
  const box = splitBoxName(boxName);
  return `<div style="padding:12px 14px;background:#f8fafc">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <p style="margin:0;color:#0f172a;font-size:16px;font-weight:900;line-height:1.2">${escapeHtml(box.code)}</p>
          <p style="margin:4px 0 0;color:#475569;font-size:12px;line-height:1.35">${escapeHtml(box.name || location || 'Location not set')}</p>
          ${box.name && location ? `<p style="margin:2px 0 0;color:#64748b;font-size:11px;line-height:1.35">${escapeHtml(location)}</p>` : ''}
        </td>
        <td align="right">${badgeHtml(`${count} item${count === 1 ? '' : 's'}`, 'blue')}</td>
      </tr>
    </table>
  </div>`;
}

function reminderListText(items: ReminderSummaryItem[]): string {
  const urgent = items.filter((item) => statusTone(item.status) === 'red').length;
  return orderedReminderGroups(items)
    .map(
      (group) =>
        `${group.boxName}\n` +
        `Location: ${group.location}\n` +
        group.items
          .map(
            (item, index) =>
              `  ${index + 1}. ${item.title}\n` +
              `     Status: ${item.status}\n` +
              `     ${item.detail}\n` +
              `     Link: ${item.link}`,
          )
          .join('\n'),
    )
    .join('\n\n') +
    `\n\nSummary: ${items.length} need action, ${urgent} urgent, ${groupByBox(items).length} boxes.`;
}

function splitBoxName(boxName: string): { code: string; name: string } {
  const parts = boxName.split(' - ');
  if (parts.length < 2) return { code: boxName, name: '' };
  return { code: parts[0] ?? boxName, name: parts.slice(1).join(' - ') };
}

function cleanTitle(title: string): string {
  return title.replace(/^TEST\s+/i, '').replace(/^Item\s+/i, '');
}

function compactDetail(detail: string): string {
  return detail
    .replace(/^Sample\s+/i, '')
    .replace(/^Inspection due date is\s+/i, 'Due: ')
    .replace(/^Inspection is overdue by\s+/i, 'Overdue: ')
    .replace(/^Expiry date:/i, 'Expiry:')
    .replace(/\.$/, '')
    .trim();
}

function shortStatus(status: string): string {
  return status
    .replace(/^Expires in\s+(\d+)\s+days?$/i, 'Expiring $1d')
    .replace(/^Due in\s+(\d+)\s+days?$/i, 'Due $1d');
}

function actionListHtml(actions: ActionSummaryItem[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px">
    ${orderedActionGroups(actions)
      .map(
        (group) => `<tr>
          <td style="border:1px solid #dbe5ef;border-radius:12px;background:#ffffff;overflow:hidden">
            ${boxGroupHeaderHtml(group.boxName, group.location, group.items.length)}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
              ${group.items
                .map((action) => {
                  const title = action.itemName ?? action.actionType;
                  return `<tr>
                    <td style="padding:10px 12px;border-top:1px solid #e2e8f0">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding-right:10px">
                            <p style="margin:0;color:#0f172a;font-size:14px;font-weight:800;line-height:1.35">${escapeHtml(title)}</p>
                            <p style="margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.35">${escapeHtml(action.actionType)} - ${escapeHtml(action.actionCode)}</p>
                          </td>
                          <td align="right" style="white-space:nowrap;vertical-align:top">
                            ${badgeHtml(action.priority ?? 'Priority not set', action.priority === 'High' ? 'red' : 'amber')}
                            <p style="margin:8px 0 0"><a href="${escapeHtml(action.link)}" style="color:#16a34a;font-size:12px;font-weight:800;text-decoration:none">Open</a></p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>`;
                })
                .join('')}
            </table>
          </td>
        </tr>`,
      )
      .join('')}
  </table>`;
}

function actionListText(actions: ActionSummaryItem[]): string {
  const high = actions.filter((action) => action.priority === 'High').length;
  return orderedActionGroups(actions)
    .map(
      (group) =>
        `${group.boxName}\n` +
        `Location: ${group.location}\n` +
        group.items
          .map(
            (action, index) =>
              `  ${index + 1}. ${action.actionType}${action.itemName ? ` - ${action.itemName}` : ''}\n` +
              `     Code: ${action.actionCode}\n` +
              `     Priority: ${action.priority ?? 'Not set'}\n` +
              `     Link: ${action.link}`,
          )
          .join('\n'),
    )
    .join('\n\n') +
    `\n\nSummary: ${actions.length} actions, ${high} high priority, ${groupByBox(actions).length} boxes.`;
}

export function buildAssignedReminderSummaryEmail(ctx: {
  recipientName: string | null;
  items: ReminderSummaryItem[];
}): { subject: string; html: string; text: string } {
  const subject = `First Aid reminders: ${ctx.items.length} item${ctx.items.length === 1 ? '' : 's'} need attention`;
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi,';
  const boxCount = groupByBox(ctx.items).length;
  const text =
    `${greeting}\n\n${ctx.items.length} assigned check${ctx.items.length === 1 ? '' : 's'} need attention across ${boxCount} box${boxCount === 1 ? '' : 'es'}.\n\n` +
    `${reminderListText(ctx.items)}\n`;
  const html = emailShell({
    title: `${ctx.items.length} assigned check${ctx.items.length === 1 ? '' : 's'} need attention`,
    preheader: `${ctx.items.length} assigned first aid check${ctx.items.length === 1 ? '' : 's'} need attention.`,
    tone: 'amber',
    introHtml: `${escapeHtml(greeting)} ${ctx.items.length} item${ctx.items.length === 1 ? '' : 's'} need attention across ${boxCount} box${boxCount === 1 ? '' : 'es'}.`,
    bodyHtml: `${summaryMetricsHtml(reminderMetrics(ctx.items))}${reminderListHtml(ctx.items)}`,
    ctaHref: ctx.items[0]?.link,
    ctaLabel: 'Open first task',
  });
  return { subject, html, text };
}

export function buildAdminDueSummaryEmail(ctx: {
  items: ReminderSummaryItem[];
}): { subject: string; html: string; text: string } {
  const subject = `First Aid due summary: ${ctx.items.length} inspection/item reminder${ctx.items.length === 1 ? '' : 's'}`;
  const boxCount = groupByBox(ctx.items).length;
  const text =
    `Admin summary: ${ctx.items.length} inspection/item reminder${ctx.items.length === 1 ? '' : 's'} need attention across ${boxCount} box${boxCount === 1 ? '' : 'es'}.\n\n` +
    `${reminderListText(ctx.items)}\n`;
  const html = emailShell({
    title: `${ctx.items.length} due reminder${ctx.items.length === 1 ? '' : 's'} across ${boxCount} box${boxCount === 1 ? '' : 'es'}`,
    preheader: `${ctx.items.length} inspection or item reminder${ctx.items.length === 1 ? '' : 's'} need attention.`,
    tone: 'amber',
    introHtml: `Review the boxes below. Urgent items are highlighted first by status.`,
    bodyHtml: `${summaryMetricsHtml(reminderMetrics(ctx.items))}${reminderListHtml(ctx.items)}`,
    ctaHref: `${PUBLIC_ENV.appUrl()}/reports`,
    ctaLabel: 'Open dashboard',
  });
  return { subject, html, text };
}

export function buildAdminActionSummaryEmail(ctx: {
  actions: ActionSummaryItem[];
}): { subject: string; html: string; text: string } {
  const subject = `First Aid action summary: ${ctx.actions.length} required action${ctx.actions.length === 1 ? '' : 's'}`;
  const boxCount = groupByBox(ctx.actions).length;
  const text =
    `Admin summary: ${ctx.actions.length} required action${ctx.actions.length === 1 ? '' : 's'} are open or in progress across ${boxCount} box${boxCount === 1 ? '' : 'es'}.\n\n` +
    actionListText(ctx.actions) +
    '\n';
  const html = emailShell({
    title: `${ctx.actions.length} required action${ctx.actions.length === 1 ? '' : 's'} across ${boxCount} box${boxCount === 1 ? '' : 'es'}`,
    preheader: `${ctx.actions.length} required action${ctx.actions.length === 1 ? '' : 's'} are open or in progress.`,
    tone: 'red',
    introHtml: `One consolidated action email. High priority items are highlighted.`,
    bodyHtml: `${summaryMetricsHtml(actionMetrics(ctx.actions))}${actionListHtml(ctx.actions)}`,
    ctaHref: `${PUBLIC_ENV.appUrl()}/actions`,
    ctaLabel: 'Open actions',
  });
  return { subject, html, text };
}
