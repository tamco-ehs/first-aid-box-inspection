// POST /api/actions/close - ESH (admin) closes an action and bulk-updates box
// items in one go. Updates the selected items' quantity/expiry, marks the
// target action Closed, also closes any other open actions resolved by those
// item updates, then recomputes box readiness.

import { ApiError, badRequest, jsonOk, notFound, safe } from '@/lib/http';
import { requireActive, requireRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { actionCloseSchema, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['admin']);

    const parsed = actionCloseSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const body = parsed.data;

    const admin = createAdminClient();

    const { data: action } = await admin
      .from('actions')
      .select('id, box_id, status')
      .eq('id', body.action_id)
      .maybeSingle();
    if (!action) throw notFound('Action not found.');
    const boxId = (action as { box_id: string }).box_id;

    // 1. Update the selected box items.
    const updatedItemIds: string[] = [];
    for (const it of body.items ?? []) {
      const patch: Record<string, unknown> = {};
      if (it.after_refill_quantity != null) patch.current_quantity = it.after_refill_quantity;
      if (it.new_expiry_date) patch.expiry_date = it.new_expiry_date;
      if (Object.keys(patch).length === 0) continue;

      const { error } = await admin
        .from('box_items')
        .update(patch)
        .eq('id', it.box_item_id)
        .eq('box_id', boxId);
      if (error) {
        console.error('[actions/close] box_item update failed:', error.message);
        throw new ApiError(500, 'close_failed', 'Could not update box items.');
      }
      updatedItemIds.push(it.box_item_id);
    }

    const now = new Date().toISOString();

    // 2. Close the target action.
    const { error: closeErr } = await admin
      .from('actions')
      .update({
        status: 'Closed',
        closed_by: ctx.userId,
        closed_at: now,
        closure_note: body.closure_note ?? null,
        new_quantity:
          body.items?.length === 1 ? body.items[0]!.after_refill_quantity ?? null : null,
        new_expiry_date: body.items?.length === 1 ? body.items[0]!.new_expiry_date ?? null : null,
      })
      .eq('id', body.action_id);
    if (closeErr) {
      console.error('[actions/close] close failed:', closeErr.message);
      throw new ApiError(500, 'close_failed', 'Could not close the action.');
    }

    // 3. Close any other open item-actions resolved by these refills.
    if (updatedItemIds.length > 0) {
      await admin
        .from('actions')
        .update({
          status: 'Closed',
          closed_by: ctx.userId,
          closed_at: now,
          closure_note: body.closure_note ?? 'Resolved with bulk top-up.',
        })
        .eq('box_id', boxId)
        .in('status', ['Open', 'In Progress'])
        .in('box_item_id', updatedItemIds);
    }

    // 4. Recompute readiness from remaining open actions.
    const { count } = await admin
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('box_id', boxId)
      .in('status', ['Open', 'In Progress']);
    const boxReady = (count ?? 0) === 0;

    return jsonOk({ ok: true, box_ready: boxReady, updated_items: updatedItemIds.length });
  });
}
