// POST /api/admin/register-actual-boxes
// One-time admin action to replace demo boxes with TAMCO's real first aid box
// register and instantiate checklist items for every box.

import { requireActive, requireRole } from '@/lib/auth';
import { badRequest, jsonOk, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASELINE_TEMPLATE_ID = 'a0000000-0000-4000-8000-000000000001';
const DUMMY_BOX_CODES = ['FAB-WH-001', 'FAB-PR-001'];

const ACTUAL_BOXES = [
  ['11111111-1111-4111-8111-111111111111', 'REC-01', 'REC-01 First Aid Box', 'Reception', 'Office'],
  ['22222222-2222-4222-8222-222222222222', 'OFF-01', 'OFF-01 First Aid Box', 'Office 1st Floor, Near Lift', 'Office'],
  ['b0000000-0000-4000-8000-000000000003', 'OFF-02', 'OFF-02 First Aid Box', 'Office 1st Floor, Purchasing', 'Office'],
  ['b0000000-0000-4000-8000-000000000004', 'OFF-03', 'OFF-03 First Aid Box', 'Office 2nd Floor, Lift', 'Office'],
  ['b0000000-0000-4000-8000-000000000005', 'OFF-04', 'OFF-04 First Aid Box', 'Office 2nd Floor, AE', 'Office'],
  ['b0000000-0000-4000-8000-000000000006', 'PRO-01', 'PRO-01 First Aid Box', 'Production Office', 'Office'],
  ['b0000000-0000-4000-8000-000000000007', 'LOA-01', 'LOA-01 First Aid Box', 'Loading Area', 'Production'],
  ['b0000000-0000-4000-8000-000000000008', 'VCB-01', 'VCB-01 First Aid Box', 'VCB Entrance', 'Production'],
  ['b0000000-0000-4000-8000-000000000009', 'RND-01', 'RND-01 First Aid Box', 'R&D Entrance', 'Production'],
  ['b0000000-0000-4000-8000-000000000010', 'RMU-01', 'RMU-01 First Aid Box', 'RMU, Inside', 'Production'],
  ['b0000000-0000-4000-8000-000000000011', 'GIS-01', 'GIS-01 First Aid Box', 'GIS Walkway', 'Production'],
  ['b0000000-0000-4000-8000-000000000012', 'WIR-01', 'WIR-01 First Aid Box', 'Wire Harness Area', 'Production'],
  ['b0000000-0000-4000-8000-000000000013', 'WIR-02', 'WIR-02 First Aid Box', 'Wire Assembly', 'Production'],
  ['b0000000-0000-4000-8000-000000000014', 'STO-01', 'STO-01 First Aid Box', 'Store', 'Production'],
  ['b0000000-0000-4000-8000-000000000015', 'STO-02', 'STO-02 First Aid Box', 'Store Office', 'Production'],
  ['b0000000-0000-4000-8000-000000000016', 'TES-01', 'TES-01 First Aid Box', 'Testing Area', 'Production'],
  ['b0000000-0000-4000-8000-000000000017', 'AIS-01', 'AIS-01 First Aid Box', 'New AIS Assembly', 'Production'],
  ['b0000000-0000-4000-8000-000000000018', 'AIS-02', 'AIS-02 First Aid Box', 'AIS Testing', 'Production'],
  ['b0000000-0000-4000-8000-000000000019', 'FAB-01', 'FAB-01 First Aid Box', 'Fabrication Area', 'Production'],
  ['b0000000-0000-4000-8000-000000000020', 'GUA-01', 'GUA-01 First Aid Box', 'Guard Post 2', 'External'],
  ['b0000000-0000-4000-8000-000000000021', 'GUA-02', 'GUA-02 First Aid Box', 'Guard Post 1', 'External'],
  ['b0000000-0000-4000-8000-000000000022', 'GIS-02', 'GIS-02 First Aid Box', 'GIS, Inside', 'Production'],
  ['b0000000-0000-4000-8000-000000000023', 'PAI-01', 'PAI-01 First Aid Box', 'Paintshop', 'Production'],
] as const;

type BoxTuple = (typeof ACTUAL_BOXES)[number];

export async function POST(): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['admin']);

    const admin = createAdminClient();
    const templateId = await resolveTemplateId(admin);
    const actualCodes = ACTUAL_BOXES.map((box) => box[1]);
    const desiredIdByCode = new Map<string, string>(ACTUAL_BOXES.map((box) => [box[1], box[0]]));

    const { data: existingActual, error: actualLookupError } = await admin
      .from('boxes')
      .select('id, box_code')
      .in('box_code', actualCodes);
    if (actualLookupError) throw new Error(actualLookupError.message);

    const conflicts = ((existingActual ?? []) as { id: string; box_code: string }[]).filter(
      (box) => desiredIdByCode.get(box.box_code) !== box.id,
    );
    if (conflicts.length > 0) {
      throw badRequest(
        `Some actual box codes already exist with different IDs: ${conflicts
          .map((box) => box.box_code)
          .join(', ')}. Rename or deactivate those duplicate rows first.`,
      );
    }

    const dummyIds = await findDummyBoxIds(admin);
    await purgeBoxes(admin, dummyIds);

    const rows = ACTUAL_BOXES.map((box) => toBoxRow(box, templateId));
    const { data: upserted, error: upsertError } = await admin
      .from('boxes')
      .upsert(rows, { onConflict: 'id' })
      .select('id, box_code');
    if (upsertError) throw new Error(upsertError.message);

    let checklistItemsCreated = 0;
    for (const box of upserted ?? []) {
      const { data, error } = await admin.rpc('apply_template_to_box', { p_box_id: box.id });
      if (error) throw new Error(error.message);
      checklistItemsCreated += Number(data ?? 0);
    }

    return jsonOk({
      ok: true,
      boxes_registered: rows.length,
      demo_boxes_removed: dummyIds.length,
      checklist_items_created: checklistItemsCreated,
    });
  });
}

async function resolveTemplateId(admin: ReturnType<typeof createAdminClient>) {
  const { data: preferred, error: preferredError } = await admin
    .from('first_aid_kit_templates')
    .select('id')
    .eq('id', BASELINE_TEMPLATE_ID)
    .maybeSingle();
  if (preferredError) throw new Error(preferredError.message);
  if (preferred?.id) return preferred.id as string;

  const { data: fallback, error: fallbackError } = await admin
    .from('first_aid_kit_templates')
    .select('id')
    .eq('is_active', true)
    .order('template_name')
    .limit(1)
    .maybeSingle();
  if (fallbackError) throw new Error(fallbackError.message);
  if (!fallback?.id) throw badRequest('No active checklist template found. Create a checklist template first.');
  return fallback.id as string;
}

async function findDummyBoxIds(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin.from('boxes').select('id').in('box_code', DUMMY_BOX_CODES);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).map((box) => box.id);
}

async function purgeBoxes(admin: ReturnType<typeof createAdminClient>, boxIds: string[]) {
  if (boxIds.length === 0) return;

  await deleteWhereIn(admin, 'topup_requests', 'box_id', boxIds);
  const inspectionIds = await selectIds(admin, 'inspections', 'box_id', boxIds);
  if (inspectionIds.length > 0) await deleteWhereIn(admin, 'inspection_items', 'inspection_id', inspectionIds);
  await deleteWhereIn(admin, 'inspections', 'box_id', boxIds);
  await deleteWhereIn(admin, 'expiry_audit_logs', 'box_id', boxIds);
  await deleteWhereIn(admin, 'first_aid_usage_logs', 'box_id', boxIds);
  await deleteWhereIn(admin, 'reminder_logs', 'box_id', boxIds);
  await deleteWhereIn(admin, 'box_assignments', 'box_id', boxIds);
  await deleteWhereIn(admin, 'box_items', 'box_id', boxIds);
  await deleteWhereIn(admin, 'boxes', 'id', boxIds);
}

async function selectIds(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  column: string,
  values: string[],
) {
  const { data, error } = await admin.from(table).select('id').in(column, values);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

async function deleteWhereIn(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  column: string,
  values: string[],
) {
  const { error } = await admin.from(table).delete().in(column, values);
  if (error) throw new Error(error.message);
}

function toBoxRow(box: BoxTuple, templateId: string) {
  const [id, box_code, box_name, location_description, area] = box;
  return {
    id,
    box_code,
    box_name,
    location_description,
    area,
    template_id: templateId,
    inspection_frequency_days: 30,
    is_active: true,
  };
}
