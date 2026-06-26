// GET /api/reports - ESH dashboard + report lists. admin + viewer only.
// Returns: the readiness dashboard (7 metric cards), Needs Attention Today,
// a compliance summary, a 6-month trend, and filtered lists (inspections,
// actions, usage logs) for the report tabs + CSV export.

import { requireActive, requireRole } from '@/lib/auth';
import { badRequest, jsonOk, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeDue } from '@/lib/logic/due.ts';
import { reportsQuerySchema, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Admin = ReturnType<typeof createAdminClient>;

interface BoxRow {
  id: string;
  box_code: string;
  box_name: string;
  location_description: string;
  area: string | null;
  created_at: string;
  inspection_frequency_days: number;
}

async function buildDashboard(admin: Admin) {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const today = now.toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: boxesData }, { data: inspData }, { data: actData }, { data: itemData }] =
    await Promise.all([
      admin
        .from('boxes')
        .select('id, box_code, box_name, location_description, area, created_at, inspection_frequency_days')
        .eq('is_active', true),
      admin.from('inspections').select('box_id, created_at, seal_intact').order('created_at', { ascending: false }),
      admin
        .from('actions')
        .select('id, action_code, box_id, action_type, category, item_name, priority, created_at, boxes(box_code, location_description, area)')
        .in('status', ['Open', 'In Progress'])
        .order('created_at', { ascending: false }),
      admin.from('box_items').select('box_id, has_expiry, expiry_date').eq('is_active', true),
    ]);

  const boxes = (boxesData ?? []) as BoxRow[];
  const inspections = (inspData ?? []) as { box_id: string; created_at: string; seal_intact: boolean | null }[];
  const actions = (actData ?? []) as unknown as Array<{
    id: string;
    action_code: string;
    box_id: string;
    action_type: string;
    category: string;
    item_name: string | null;
    priority: string | null;
    created_at: string;
    boxes: { box_code: string; location_description: string; area: string | null } | null;
  }>;
  const items = (itemData ?? []) as { box_id: string; has_expiry: boolean; expiry_date: string | null }[];

  // latest inspection per box (rows are desc-ordered)
  const latestByBox = new Map<string, { created_at: string; seal_intact: boolean | null }>();
  for (const r of inspections) if (!latestByBox.has(r.box_id)) latestByBox.set(r.box_id, r);

  let due_this_month = 0;
  let overdue = 0;
  let seal_broken_used = 0;
  for (const b of boxes) {
    const latest = latestByBox.get(b.id);
    const due = computeDue({
      lastInspectionAt: latest?.created_at ?? null,
      boxCreatedAt: b.created_at,
      frequencyDays: b.inspection_frequency_days,
      now,
    });
    if (due.due_status === 'Overdue') overdue++;
    const nd = new Date(due.next_due_date);
    if (nd >= startOfMonth && nd <= endOfMonth) due_this_month++;
    if (latest && latest.seal_intact === false) seal_broken_used++;
  }

  const expired_items = items.filter((i) => i.has_expiry && i.expiry_date && i.expiry_date < today).length;
  const expiring_30_days = items.filter(
    (i) => i.has_expiry && i.expiry_date && i.expiry_date >= today && i.expiry_date <= in30,
  ).length;

  const quick_check_issues = actions.filter((a) => a.category === 'quick_check').length;
  const open_actions = actions.length;

  const attentionBoxes = new Set(actions.map((a) => a.box_id));
  const total = boxes.length;
  const attention = attentionBoxes.size;
  const completed = Math.max(0, total - attention);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 100;

  const needs_attention = actions.slice(0, 12).map((a) => ({
    id: a.id,
    action_code: a.action_code,
    box_code: a.boxes?.box_code ?? '—',
    location: [a.boxes?.location_description, a.boxes?.area].filter(Boolean).join(' · '),
    issue_type: a.action_type,
    item_name: a.item_name,
    priority: a.priority,
    created_at: a.created_at,
  }));

  // 6-month inspection trend
  const trend: { label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    const label = m.toLocaleString('en-GB', { month: 'short' });
    const count = inspections.filter(
      (r) => new Date(r.created_at) >= m && new Date(r.created_at) < next,
    ).length;
    trend.push({ label, count });
  }

  return {
    dashboard: {
      due_this_month,
      overdue,
      quick_check_issues,
      seal_broken_used,
      expired_items,
      expiring_30_days,
      open_actions,
    },
    compliance: { percent, completed, attention, total },
    needs_attention,
    trend,
  };
}

export async function GET(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['admin', 'viewer']);

    const url = new URL(req.url);
    const parsed = reportsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const f = parsed.data;

    const admin = createAdminClient();
    const toExclusive = f.to ? new Date(new Date(f.to).getTime() + 86_400_000).toISOString() : null;

    let areaBoxIds: string[] | null = null;
    if (f.area) {
      const { data } = await admin.from('boxes').select('id').eq('area', f.area);
      const ids = ((data ?? []) as { id: string }[]).map((b) => b.id);
      areaBoxIds = ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'];
    }

    // inspections
    let iq = admin
      .from('inspections')
      .select(
        'id, box_id, inspector_name, inspector_department, overall_status, box_accessible, box_clean, seal_intact, contact_visible, item_check_performed, created_at, notes, boxes(box_code, box_name, area)',
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (f.from) iq = iq.gte('created_at', f.from);
    if (toExclusive) iq = iq.lt('created_at', toExclusive);
    if (f.box_id) iq = iq.eq('box_id', f.box_id);
    if (f.status) iq = iq.eq('overall_status', f.status);
    if (areaBoxIds) iq = iq.in('box_id', areaBoxIds);
    const { data: inspections } = await iq;

    // actions
    let aq = admin
      .from('actions')
      .select(
        'id, action_code, box_id, action_type, category, item_name, required_quantity, observed_quantity, priority, status, details, closure_note, created_at, closed_at, boxes(box_code, area)',
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (f.from) aq = aq.gte('created_at', f.from);
    if (toExclusive) aq = aq.lt('created_at', toExclusive);
    if (f.box_id) aq = aq.eq('box_id', f.box_id);
    if (areaBoxIds) aq = aq.in('box_id', areaBoxIds);
    const { data: actions } = await aq;

    // usage
    let uq = admin
      .from('first_aid_usage_logs')
      .select('id, box_id, user_name, department, usage_purpose, items_taken, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (f.from) uq = uq.gte('created_at', f.from);
    if (toExclusive) uq = uq.lt('created_at', toExclusive);
    if (f.box_id) uq = uq.eq('box_id', f.box_id);
    if (areaBoxIds) uq = uq.in('box_id', areaBoxIds);
    const { data: usage } = await uq;

    const dash = await buildDashboard(admin);

    return jsonOk({
      filters: f,
      ...dash,
      inspections: inspections ?? [],
      actions: actions ?? [],
      usage_logs: usage ?? [],
    });
  });
}
