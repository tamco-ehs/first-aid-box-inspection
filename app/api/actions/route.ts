// GET /api/actions - ESH action list. admin/viewer see all; first_aider sees
// actions for their assigned boxes. Defaults to Open + In Progress.

import { getAssignedBoxIds, requireActive } from '@/lib/auth';
import { badRequest, jsonOk, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { actionsQuerySchema, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT =
  'id, action_code, box_id, inspection_id, action_type, category, box_item_id, item_name, ' +
  'required_quantity, observed_quantity, new_quantity, expiry_date, new_expiry_date, priority, ' +
  'status, details, closure_note, created_at, closed_at, ' +
  'boxes(box_code, box_name, location_description, area)';

export async function GET(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();

    const url = new URL(req.url);
    const parsed = actionsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const f = parsed.data;

    const admin = createAdminClient();
    let q = admin.from('actions').select(SELECT).order('created_at', { ascending: false }).limit(500);

    if (f.status && f.status !== 'all') q = q.eq('status', f.status);
    else if (!f.status) q = q.in('status', ['Open', 'In Progress']);
    if (f.box_id) q = q.eq('box_id', f.box_id);
    if (f.category) q = q.eq('category', f.category);

    if (ctx.profile.role === 'first_aider') {
      const ids = await getAssignedBoxIds(ctx.userId);
      if (ids.length === 0) return jsonOk({ actions: [] });
      q = q.in('box_id', ids);
    }

    const { data, error } = await q;
    if (error) {
      console.error('[actions] list failed:', error.message);
      throw badRequest('Could not load actions.');
    }
    return jsonOk({ actions: data ?? [] });
  });
}
