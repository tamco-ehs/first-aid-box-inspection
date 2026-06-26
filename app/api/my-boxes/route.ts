// GET /api/my-boxes - the boxes the caller may act on, each with its inspection
// due status, sorted Overdue -> Due Soon -> Not Yet Inspected -> Completed.
//   admin / viewer : all active boxes
//   first_aider    : only actively-assigned boxes (auto-preselect when 1)

import { getAssignedBoxIds, requireActive } from '@/lib/auth';
import { jsonOk, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { compareByDue, computeDue } from '@/lib/logic/due.ts';
import { primaryAction, statusTag } from '@/lib/logic/actions.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BoxRow {
  id: string;
  box_code: string;
  box_name: string;
  location_description: string;
  area: string | null;
  inspection_frequency_days: number;
  created_at: string;
}

interface AssignmentRow {
  box_id: string;
  is_primary_responsible: boolean;
  profiles: { full_name: string; email: string | null } | null;
}

export async function GET(): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    const admin = createAdminClient();
    const now = new Date();

    let query = admin
      .from('boxes')
      .select('id, box_code, box_name, location_description, area, inspection_frequency_days, created_at')
      .eq('is_active', true);

    if (ctx.profile.role === 'first_aider') {
      const assignedIds = await getAssignedBoxIds(ctx.userId);
      if (assignedIds.length === 0) {
        return jsonOk({ role: ctx.profile.role, count: 0, boxes: [] });
      }
      query = query.in('id', assignedIds);
    }

    const { data: boxesData, error } = await query;
    if (error) {
      console.error('[my-boxes] boxes query failed:', error.message);
      throw new Error('boxes query failed');
    }
    const boxes = (boxesData ?? []) as BoxRow[];
    if (boxes.length === 0) {
      return jsonOk({ role: ctx.profile.role, count: 0, boxes: [] });
    }

    const boxIds = boxes.map((b) => b.id);

    // Latest inspection date per box (one pass over desc-ordered rows).
    const { data: inspData } = await admin
      .from('inspections')
      .select('box_id, created_at')
      .in('box_id', boxIds)
      .order('created_at', { ascending: false });

    const lastInspectionByBox = new Map<string, string>();
    for (const row of (inspData ?? []) as { box_id: string; created_at: string }[]) {
      if (!lastInspectionByBox.has(row.box_id)) lastInspectionByBox.set(row.box_id, row.created_at);
    }

    // Open actions per box drive the "Issue Found" badge + readiness.
    const { data: openActs } = await admin
      .from('actions')
      .select('box_id')
      .in('box_id', boxIds)
      .in('status', ['Open', 'In Progress']);
    const openByBox = new Map<string, number>();
    for (const a of (openActs ?? []) as { box_id: string }[]) {
      openByBox.set(a.box_id, (openByBox.get(a.box_id) ?? 0) + 1);
    }

    // Active assignments -> assigned inspectors per box.
    const { data: assignData } = await admin
      .from('box_assignments')
      .select('box_id, is_primary_responsible, profiles(full_name, email)')
      .in('box_id', boxIds)
      .eq('is_active', true);

    const inspectorsByBox = new Map<
      string,
      { full_name: string; email: string | null; is_primary: boolean }[]
    >();
    for (const a of (assignData ?? []) as unknown as AssignmentRow[]) {
      if (!a.profiles) continue;
      const list = inspectorsByBox.get(a.box_id) ?? [];
      list.push({
        full_name: a.profiles.full_name,
        email: a.profiles.email,
        is_primary: a.is_primary_responsible,
      });
      inspectorsByBox.set(a.box_id, list);
    }

    const result = boxes.map((b) => {
      const lastInspectionAt = lastInspectionByBox.get(b.id) ?? null;
      const due = computeDue({
        lastInspectionAt,
        boxCreatedAt: b.created_at,
        frequencyDays: b.inspection_frequency_days,
        now,
      });
      const openActions = openByBox.get(b.id) ?? 0;
      const tag = statusTag(openActions, due.due_status);
      return {
        box_id: b.id,
        box_code: b.box_code,
        box_name: b.box_name,
        location_description: b.location_description,
        area: b.area,
        last_inspection_date: lastInspectionAt,
        next_due_date: due.next_due_date,
        due_status: due.due_status,
        days_overdue: due.days_overdue,
        open_actions: openActions,
        status_tag: tag,
        primary_action: primaryAction(tag),
        assigned_inspectors: inspectorsByBox.get(b.id) ?? [],
      };
    });

    // Issue boxes first, then by due urgency.
    result.sort((a, b) => {
      const ai = a.status_tag === 'Issue Found' ? 0 : 1;
      const bi = b.status_tag === 'Issue Found' ? 0 : 1;
      if (ai !== bi) return ai - bi;
      return compareByDue(a, b);
    });

    return jsonOk({ role: ctx.profile.role, count: result.length, boxes: result });
  });
}
