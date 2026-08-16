// GET /api/inspections/[id] - everything a single inspection recorded, so ESH
// can click a row in the report and see exactly what the first aider did:
// the 4 quick-check answers, every item checked (with quantities/expiry), the
// live box photo, notes, and the actions that inspection raised.
//
// Access: admin roles see any inspection; a first aider ("user") only for boxes
// they are assigned to - enforced by requireBoxAccess, same as everywhere else.

import { requireActive, requireBoxAccess } from '@/lib/auth';
import { jsonOk, notFound, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return safe(async () => {
    const { id } = await params;
    const ctx = await requireActive();
    const admin = createAdminClient();

    const { data: insp } = await admin
      .from('inspections')
      .select(
        'id, box_id, created_at, inspector_id, inspector_name, inspector_department, overall_status, ' +
          'box_accessible, box_clean, seal_intact, contact_visible, item_check_performed, ' +
          'box_photo_url, notes, submitted_device',
      )
      .eq('id', id)
      .maybeSingle();

    if (!insp) throw notFound('Inspection not found.');
    const inspection = insp as unknown as { box_id: string };

    // Same authorization rule as the rest of the app.
    await requireBoxAccess(ctx, inspection.box_id, { write: false });

    const [{ data: box }, { data: items }, { data: actions }] = await Promise.all([
      admin
        .from('boxes')
        .select('box_code, box_name, location_description, area')
        .eq('id', inspection.box_id)
        .maybeSingle(),
      admin
        .from('inspection_items')
        .select('id, item_name, required_quantity, observed_quantity, expiry_date, item_status, remarks')
        .eq('inspection_id', id)
        .order('item_name', { ascending: true }),
      admin
        .from('actions')
        .select('id, action_code, action_type, category, item_name, priority, status')
        .eq('inspection_id', id)
        .order('created_at', { ascending: true }),
    ]);

    return jsonOk({
      inspection: insp,
      box: box ?? null,
      items: items ?? [],
      actions: actions ?? [],
    });
  });
}
