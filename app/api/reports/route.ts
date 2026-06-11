// GET /api/reports - read-only reporting for admin + viewer. Returns filtered
// inspections, inspection items, top-up requests, usage logs, and a current
// dashboard summary. First aiders and the public get 403 (no aggregate reads).

import { requireActive, requireRole } from '@/lib/auth';
import { badRequest, jsonOk, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeDue } from '@/lib/logic/due.ts';
import { reportsQuerySchema, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Admin = ReturnType<typeof createAdminClient>;

async function headCount(builder: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await builder;
  return count ?? 0;
}

async function buildDashboard(admin: Admin) {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const today = now.toISOString().slice(0, 10);
  const urgent = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);

  // All of these are independent, so fire them concurrently (one round-trip of
  // latency instead of ~15 sequential ones - this is what made the dashboard slow).
  const [
    total_boxes,
    boxesRes,
    inspRes,
    open_topup_requests,
    topupBoxesRes,
    expiredRes,
    soonRes,
    urgentRes,
    missingDateRes,
    missingStatusRes,
    mismatchRes,
    noPhotoRes,
    criticalRes,
    usage_logs_this_month,
  ] = await Promise.all([
    headCount(admin.from('boxes').select('id', { count: 'exact', head: true }).eq('is_active', true)),
    admin.from('boxes').select('id, created_at, inspection_frequency_days').eq('is_active', true),
    admin.from('inspections').select('box_id, created_at').order('created_at', { ascending: false }),
    headCount(
      admin.from('topup_requests').select('id', { count: 'exact', head: true }).in('status', ['Open', 'In Progress']),
    ),
    admin.from('topup_requests').select('box_id').in('status', ['Open', 'In Progress']),
    admin
      .from('box_items')
      .select('box_id')
      .eq('is_active', true)
      .eq('has_expiry', true)
      .not('expiry_date', 'is', null)
      .lt('expiry_date', today),
    admin
      .from('box_items')
      .select('box_id')
      .eq('is_active', true)
      .eq('has_expiry', true)
      .gte('expiry_date', today)
      .lte('expiry_date', soon),
    admin
      .from('box_items')
      .select('box_id')
      .eq('is_active', true)
      .eq('has_expiry', true)
      .gte('expiry_date', today)
      .lte('expiry_date', urgent),
    admin.from('box_items').select('box_id').eq('is_active', true).eq('has_expiry', true).is('expiry_date', null),
    admin
      .from('box_items')
      .select('box_id')
      .eq('is_active', true)
      .eq('has_expiry', true)
      .eq('expiry_status', 'No expiry date recorded'),
    admin
      .from('box_items')
      .select('box_id')
      .eq('is_active', true)
      .eq('has_expiry', true)
      .eq('expiry_status', 'Expiry label mismatch'),
    admin.from('box_items_effective').select('id').eq('is_active', true).is('effective_item_photo_url', null),
    admin
      .from('box_items_effective')
      .select('id')
      .eq('is_active', true)
      .eq('is_critical', true)
      .eq('has_expiry', true)
      .not('expiry_date', 'is', null)
      .lt('expiry_date', today),
    headCount(
      admin.from('first_aid_usage_logs').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth),
    ),
  ]);

  const boxes = boxesRes.data;
  const insp = inspRes.data;
  const topupBoxes = topupBoxesRes.data;
  const expiredItems = expiredRes.data;
  const soonItems = soonRes.data;
  const urgentItems = urgentRes.data;
  const missingExpiryDateItems = missingDateRes.data;
  const missingExpiryStatusItems = missingStatusRes.data;
  const mismatchItems = mismatchRes.data;
  const noPhotoItems = noPhotoRes.data;
  const criticalExpired = criticalRes.data;

  // Overdue + inspected-this-month need the latest inspection per box.
  const lastByBox = new Map<string, string>();
  const inspectedThisMonth = new Set<string>();
  for (const r of (insp ?? []) as { box_id: string; created_at: string }[]) {
    if (!lastByBox.has(r.box_id)) lastByBox.set(r.box_id, r.created_at);
    if (r.created_at >= startOfMonth) inspectedThisMonth.add(r.box_id);
  }

  let overdue_boxes = 0;
  for (const b of (boxes ?? []) as { id: string; created_at: string; inspection_frequency_days: number }[]) {
    const due = computeDue({
      lastInspectionAt: lastByBox.get(b.id) ?? null,
      boxCreatedAt: b.created_at,
      frequencyDays: b.inspection_frequency_days,
      now,
    });
    if (due.due_status === 'Overdue') overdue_boxes++;
  }

  const boxes_needing_topup = new Set(((topupBoxes ?? []) as { box_id: string }[]).map((t) => t.box_id)).size;
  const boxes_with_expired_items = new Set(((expiredItems ?? []) as { box_id: string }[]).map((i) => i.box_id)).size;
  const boxes_with_expiring_soon_items = new Set(
    ((soonItems ?? []) as { box_id: string }[]).map((i) => i.box_id),
  ).size;
  const items_expiring_within_30_days = (urgentItems ?? []).length;
  const boxes_with_missing_expiry_dates = new Set(
    ([...(missingExpiryDateItems ?? []), ...(missingExpiryStatusItems ?? [])] as { box_id: string }[]).map(
      (i) => i.box_id,
    ),
  ).size;
  const boxes_with_expiry_label_mismatch = new Set(
    ((mismatchItems ?? []) as { box_id: string }[]).map((i) => i.box_id),
  ).size;

  return {
    total_boxes,
    boxes_inspected_this_month: inspectedThisMonth.size,
    overdue_boxes,
    boxes_needing_topup,
    boxes_with_expired_items,
    boxes_with_expiring_soon_items,
    boxes_with_missing_expiry_dates,
    boxes_with_expiry_label_mismatch,
    items_expiring_within_30_days,
    critical_now: (criticalExpired ?? []).length,
    items_expired: (expiredItems ?? []).length,
    items_expiry_verification: (mismatchItems ?? []).length,
    items_baseline_missing: (missingExpiryDateItems ?? []).length,
    items_missing_photo: (noPhotoItems ?? []).length,
    open_topup_requests,
    usage_logs_this_month,
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
    // Make `to` inclusive of the whole day.
    const toExclusive = f.to ? new Date(new Date(f.to).getTime() + 86_400_000).toISOString() : null;

    // area filter -> restrict to those box ids
    let areaBoxIds: string[] | null = null;
    if (f.area) {
      const { data } = await admin.from('boxes').select('id').eq('area', f.area);
      const ids = ((data ?? []) as { id: string }[]).map((b) => b.id);
      areaBoxIds = ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'];
    }

    // --- inspections ---
    let iq = admin
      .from('inspections')
      .select(
        'id, box_id, inspector_id, inspector_name, inspector_department, overall_status, created_at, box_photo_url, notes, boxes(box_code, box_name, area)',
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (f.from) iq = iq.gte('created_at', f.from);
    if (toExclusive) iq = iq.lt('created_at', toExclusive);
    if (f.box_id) iq = iq.eq('box_id', f.box_id);
    if (f.inspector_id) iq = iq.eq('inspector_id', f.inspector_id);
    if (f.department) iq = iq.eq('inspector_department', f.department);
    if (f.status) iq = iq.eq('overall_status', f.status);
    if (areaBoxIds) iq = iq.in('box_id', areaBoxIds);
    const { data: inspections } = await iq;
    const inspectionIds = ((inspections ?? []) as { id: string }[]).map((i) => i.id);
    const inspectionContext = new Map<
      string,
      { box_id: string; boxes: { box_code: string; box_name: string; area: string | null } | null }
    >();
    type InspectionContextRow = {
      id: string;
      box_id: string;
      boxes:
        | { box_code: string; box_name: string; area: string | null }
        | { box_code: string; box_name: string; area: string | null }[]
        | null;
    };
    for (const i of (inspections ?? []) as unknown as InspectionContextRow[]) {
      const box = Array.isArray(i.boxes) ? (i.boxes[0] ?? null) : i.boxes;
      inspectionContext.set(i.id, { box_id: i.box_id, boxes: box });
    }

    // --- inspection items (optional issue-type filter) ---
    let inspection_items: unknown[] = [];
    if (inspectionIds.length > 0) {
      let itq = admin
        .from('inspection_items')
        .select('*')
        .in('inspection_id', inspectionIds)
        .limit(5000);
      switch (f.issue_type) {
        case 'expired':
          itq = itq.eq('is_expired', true);
          break;
        case 'expiring_soon':
          itq = itq.eq('expires_soon', true);
          break;
        case 'low_stock':
          itq = itq.eq('item_status', 'Low Stock');
          break;
        case 'missing':
          itq = itq.eq('item_status', 'Missing');
          break;
        case 'damaged':
          itq = itq.eq('item_status', 'Damaged');
          break;
        case 'topup':
          itq = itq.eq('topup_required', true);
          break;
      }
      const { data } = await itq;
      inspection_items = ((data ?? []) as Record<string, unknown>[]).map((row) => {
        const ctx = inspectionContext.get(String(row.inspection_id));
        return { ...row, box_id: ctx?.box_id ?? null, boxes: ctx?.boxes ?? null };
      });
    }

    // --- top-up requests ---
    let tq = admin
      .from('topup_requests')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(500);
    if (f.from) tq = tq.gte('requested_at', f.from);
    if (toExclusive) tq = tq.lt('requested_at', toExclusive);
    if (f.box_id) tq = tq.eq('box_id', f.box_id);
    if (areaBoxIds) tq = tq.in('box_id', areaBoxIds);
    const { data: topups } = await tq;
    const topupsWithPhotos = await attachTopupPhotos(
      admin,
      (topups ?? []) as Record<string, unknown>[],
    );

    // --- current expiry reminders from per-box inventory ---
    let eq = admin
      .from('box_items')
      .select('id, box_id, item_name, expiry_date, expiry_status, last_verified_date, last_replaced_date')
      .eq('is_active', true)
      .eq('has_expiry', true)
      .neq('expiry_status', 'Valid')
      .limit(500);
    if (f.box_id) eq = eq.eq('box_id', f.box_id);
    if (areaBoxIds) eq = eq.in('box_id', areaBoxIds);
    const { data: expiryItems } = await eq;

    // --- usage logs ---
    let uq = admin
      .from('first_aid_usage_logs')
      .select('id, box_id, user_name, department, usage_purpose, items_taken, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (f.from) uq = uq.gte('created_at', f.from);
    if (toExclusive) uq = uq.lt('created_at', toExclusive);
    if (f.box_id) uq = uq.eq('box_id', f.box_id);
    if (f.department) uq = uq.eq('department', f.department);
    if (areaBoxIds) uq = uq.in('box_id', areaBoxIds);
    const { data: usage } = await uq;

    const dashboard = await buildDashboard(admin);

    return jsonOk({
      filters: f,
      dashboard,
      inspections: inspections ?? [],
      inspection_items,
      expiry_items: expiryItems ?? [],
      topup_requests: topupsWithPhotos,
      usage_logs: usage ?? [],
    });
  });
}

async function attachTopupPhotos(admin: Admin, rows: Record<string, unknown>[]) {
  const boxIds = [...new Set(rows.map((row) => String(row.box_id ?? '')).filter(Boolean))];
  if (boxIds.length === 0) return rows.map((row) => ({ ...row, item_photo_url: null }));

  const { data, error } = await admin
    .from('box_items_effective')
    .select('box_id, item_name, effective_item_photo_url')
    .in('box_id', boxIds)
    .eq('is_active', true);
  if (error) throw new Error(error.message);

  const photos = new Map(
    ((data ?? []) as { box_id: string; item_name: string; effective_item_photo_url: string | null }[]).map((row) => [
      topupPhotoKey(row.box_id, row.item_name),
      row.effective_item_photo_url,
    ]),
  );

  return rows.map((row) => ({
    ...row,
    item_photo_url: photos.get(topupPhotoKey(String(row.box_id ?? ''), String(row.item_name ?? ''))) ?? null,
  }));
}

function topupPhotoKey(boxId: string, itemName: string) {
  return `${boxId}:${itemName.trim().toLowerCase()}`;
}
