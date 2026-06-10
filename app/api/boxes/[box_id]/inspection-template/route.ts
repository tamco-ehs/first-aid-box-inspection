// GET /api/boxes/[box_id]/inspection-template - the checklist the inspection
// form is generated from: box details, template, every active box item (with
// its effective reference photo and current known state), and a short summary
// of the last inspection.
//   admin: any active box | first_aider: assigned only | viewer: read-only
// Anyone else -> 403 (handled inside requireBoxAccess).

import { requireActive, requireBoxAccess } from '@/lib/auth';
import { jsonOk, notFound, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EffectiveItem {
  id: string;
  item_code: string | null;
  item_name: string;
  measurement_type: string;
  required_quantity: number | null;
  unit: string | null;
  has_expiry: boolean;
  expiry_date: string | null;
  current_quantity: number | null;
  current_volume_level: string | null;
  current_present_status: string | null;
  effective_item_photo_url: string | null;
  display_order: number | null;
  is_critical: boolean;
  expiry_warning_days: number | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ box_id: string }> },
): Promise<Response> {
  return safe(async () => {
    const { box_id } = await params;
    const ctx = await requireActive();
    await requireBoxAccess(ctx, box_id, { write: false });

    const admin = createAdminClient();

    const { data: box } = await admin
      .from('boxes')
      .select('id, box_code, box_name, location_description, area, inspection_frequency_days, is_active, template_id')
      .eq('id', box_id)
      .maybeSingle();

    if (!box || !(box as { is_active: boolean }).is_active) {
      throw notFound('First aid box not found or inactive.');
    }
    const boxRow = box as {
      id: string;
      box_code: string;
      box_name: string;
      location_description: string;
      area: string | null;
      inspection_frequency_days: number;
      template_id: string | null;
    };

    let template = null;
    if (boxRow.template_id) {
      const { data } = await admin
        .from('first_aid_kit_templates')
        .select('id, template_name, guideline_reference, description')
        .eq('id', boxRow.template_id)
        .maybeSingle();
      template = data;
    }

    const { data: itemsData } = await admin
      .from('box_items_effective')
      .select(
        'id, item_code, item_name, measurement_type, required_quantity, unit, has_expiry, expiry_date, current_quantity, current_volume_level, current_present_status, effective_item_photo_url, display_order, is_critical, expiry_warning_days',
      )
      .eq('box_id', box_id)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    const items = ((itemsData ?? []) as EffectiveItem[]).map((it) => ({
      box_item_id: it.id,
      item_code: it.item_code,
      item_name: it.item_name,
      measurement_type: it.measurement_type,
      required_quantity: it.required_quantity,
      unit: it.unit,
      has_expiry: it.has_expiry,
      expiry_warning_days: it.expiry_warning_days,
      is_critical: it.is_critical,
      // last known state (helps the inspector see what changed)
      current_quantity: it.current_quantity,
      current_volume_level: it.current_volume_level,
      current_present_status: it.current_present_status,
      current_expiry_date: it.expiry_date,
      // reference photo: box override -> template default -> null (UI placeholder)
      item_photo_url: it.effective_item_photo_url,
      display_order: it.display_order,
    }));

    const { data: lastInspection } = await admin
      .from('inspections')
      .select('id, overall_status, created_at, inspector_name, notes')
      .eq('box_id', box_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return jsonOk({
      box: {
        box_id: boxRow.id,
        box_code: boxRow.box_code,
        box_name: boxRow.box_name,
        location_description: boxRow.location_description,
        area: boxRow.area,
        inspection_frequency_days: boxRow.inspection_frequency_days,
      },
      template,
      item_count: items.length,
      items,
      last_inspection: lastInspection ?? null,
    });
  });
}
