// POST /api/inspections - submit a QUICK inspection (4 yes/no answers) plus an
// OPTIONAL item check (only when the seal was broken or an expired item needs
// replacement). The server raises ESH "actions" for every issue found and sets
// the box's readiness.
//
// Security (unchanged from before): authenticated + active, role admin or
// user/admin, box active, and (user) assigned to the box. All writes go
// through the service role after those checks; the inspection is rolled back on
// any post-insert failure.

import { ApiError, badRequest, jsonOk, notFound, safe } from '@/lib/http';
import { requireActive, requireBoxAccess, requireRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_ENV } from '@/lib/env';
import { INSPECTION_PHOTO_FOLDER, isAllowedCloudinaryUrl } from '@/lib/logic/cloudinary-url.ts';
import { itemActionType, quickCheckActions, type ActionType } from '@/lib/logic/actions.ts';
import { quickInspectionSchema, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SpecRow {
  id: string;
  item_name: string;
  required_quantity: number | null;
  unit: string | null;
  has_expiry: boolean;
  expiry_date: string | null;
}

interface ActionInsert {
  box_id: string;
  inspection_id: string;
  action_type: ActionType;
  category: 'quick_check' | 'item';
  box_item_id: string | null;
  item_name: string | null;
  required_quantity: number | null;
  observed_quantity: number | null;
  expiry_date: string | null;
  new_expiry_date: string | null;
  priority: 'Low' | 'Medium' | 'High';
  details: string | null;
  created_by: string;
}

function quickKey(t: string) {
  return `qc:${t}`;
}
function itemKey(name: string, t: string) {
  return `item:${name.trim().toLowerCase()}:${t}`;
}

export async function POST(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['superadmin', 'admin', 'user']);

    const parsed = quickInspectionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const body = parsed.data;

    const admin = createAdminClient();

    const { data: box } = await admin
      .from('boxes')
      .select('id, is_active')
      .eq('id', body.box_id)
      .maybeSingle();
    if (!box || !(box as { is_active: boolean }).is_active) {
      throw notFound('First aid box not found or inactive.');
    }
    await requireBoxAccess(ctx, body.box_id, { write: true });

    // Optional box photo, validated if present.
    if (
      body.box_photo_url &&
      !isAllowedCloudinaryUrl(body.box_photo_url, PUBLIC_ENV.cloudinaryCloudName(), [
        INSPECTION_PHOTO_FOLDER,
      ])
    ) {
      throw badRequest('The box photo must be an image uploaded through this app.');
    }

    const itemCheck = body.item_check ?? [];
    const itemCheckPerformed = itemCheck.length > 0;

    // Load the box's items (for validation + names/required quantities).
    let specById = new Map<string, SpecRow>();
    if (itemCheckPerformed) {
      const { data: specs } = await admin
        .from('box_items_effective')
        .select('id, item_name, required_quantity, unit, has_expiry, expiry_date')
        .eq('box_id', body.box_id)
        .eq('is_active', true);
      specById = new Map(((specs ?? []) as SpecRow[]).map((s) => [s.id, s]));
    }

    // ---- decide actions + inspection lines + box-item updates ---------------
    const quick = quickCheckActions({
      box_accessible: body.box_accessible,
      box_clean: body.box_clean,
      seal_intact: body.seal_intact,
      contact_visible: body.contact_visible,
    });

    const itemLines: Array<{
      box_item_id: string;
      item_name: string;
      required_quantity: number | null;
      observed_quantity: number | null;
      expiry_date: string | null;
      item_status: string;
      remarks: string | null;
    }> = [];
    const itemActions: Omit<ActionInsert, 'box_id' | 'inspection_id' | 'created_by'>[] = [];
    const boxItemUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const seen = new Set<string>();

    for (const it of itemCheck) {
      const spec = specById.get(it.box_item_id);
      if (!spec) throw badRequest('A submitted item does not belong to this box.');
      if (seen.has(it.box_item_id)) throw badRequest('Duplicate item in submission.');
      seen.add(it.box_item_id);
      if (it.status === 'Expired' && !spec.has_expiry) {
        throw badRequest(`"${spec.item_name}": only items marked as expirable in the master list can be marked Expired.`);
      }
      if (it.status === 'Low Qty' && it.observed_quantity == null) {
        throw badRequest(`"${spec.item_name}": current quantity is required for Low Qty.`);
      }

      const observed =
        it.status === 'Missing' ? 0 : it.status === 'OK' ? spec.required_quantity : it.observed_quantity ?? null;
      const currentExpiry = spec.has_expiry ? spec.expiry_date ?? null : null;

      itemLines.push({
        box_item_id: spec.id,
        item_name: spec.item_name,
        required_quantity: spec.required_quantity,
        observed_quantity: observed,
        expiry_date: currentExpiry,
        item_status: it.status,
        remarks: null,
      });

      const mapped = itemActionType(it.status);
      if (mapped) {
        itemActions.push({
          action_type: mapped.action_type,
          category: 'item',
          box_item_id: spec.id,
          item_name: spec.item_name,
          required_quantity: spec.required_quantity,
          observed_quantity: observed,
          expiry_date: it.status === 'Expired' ? currentExpiry : null,
          new_expiry_date: null,
          priority: mapped.priority,
          details: null,
        });
      }

      // Box-item state update from the check.
      const patch: Record<string, unknown> = {};
      if (it.status === 'Missing') patch.current_quantity = 0;
      else if (it.status === 'Low Qty' && it.observed_quantity != null)
        patch.current_quantity = it.observed_quantity;
      else if (it.status === 'OK' && spec.required_quantity != null)
        patch.current_quantity = spec.required_quantity;
      if (Object.keys(patch).length > 0) boxItemUpdates.push({ id: spec.id, patch });
    }

    const totalIssues = quick.length + itemActions.length;
    const overall = totalIssues > 0 ? 'Action Required' : 'Ready';

    // ---- write (service role) with rollback ---------------------------------
    const ua = req.headers.get('user-agent')?.slice(0, 400) ?? null;
    const { data: inspIns, error: inspErr } = await admin
      .from('inspections')
      .insert({
        box_id: body.box_id,
        inspector_id: ctx.userId,
        inspector_name: ctx.profile.full_name,
        inspector_department: ctx.profile.department,
        overall_status: overall,
        box_accessible: body.box_accessible,
        box_clean: body.box_clean,
        seal_intact: body.seal_intact,
        contact_visible: body.contact_visible,
        item_check_performed: itemCheckPerformed,
        box_photo_url: body.box_photo_url ?? null,
        box_photo_cloudinary_public_id: body.box_photo_cloudinary_public_id ?? null,
        notes: body.notes ?? null,
        submitted_device: body.submitted_device ?? null,
        submitted_user_agent: ua,
      })
      .select('id')
      .single();
    if (inspErr || !inspIns) {
      console.error('[inspections] header insert failed:', inspErr?.message);
      throw new ApiError(500, 'inspection_failed', 'Could not save the inspection.');
    }
    const inspectionId = (inspIns as { id: string }).id;

    try {
      if (itemLines.length > 0) {
        const { error } = await admin.from('inspection_items').insert(
          itemLines.map((l) => ({ inspection_id: inspectionId, ...l })),
        );
        if (error) throw error;
      }

      // De-dup against existing open actions for this box.
      const { data: openActions } = await admin
        .from('actions')
        .select('action_type, category, item_name')
        .eq('box_id', body.box_id)
        .in('status', ['Open', 'In Progress']);
      const existing = new Set<string>();
      for (const a of (openActions ?? []) as { action_type: string; category: string; item_name: string | null }[]) {
        existing.add(a.category === 'quick_check' ? quickKey(a.action_type) : itemKey(a.item_name ?? '', a.action_type));
      }

      const toInsert: ActionInsert[] = [];
      for (const q of quick) {
        const key = quickKey(q.action_type);
        if (existing.has(key)) continue;
        existing.add(key);
        toInsert.push({
          box_id: body.box_id,
          inspection_id: inspectionId,
          action_type: q.action_type,
          category: 'quick_check',
          box_item_id: null,
          item_name: null,
          required_quantity: null,
          observed_quantity: null,
          expiry_date: null,
          new_expiry_date: null,
          priority: q.priority,
          details: body.notes ?? null,
          created_by: ctx.userId,
        });
      }
      for (const ia of itemActions) {
        const key = itemKey(ia.item_name ?? '', ia.action_type);
        if (existing.has(key)) continue;
        existing.add(key);
        toInsert.push({ ...ia, box_id: body.box_id, inspection_id: inspectionId, created_by: ctx.userId });
      }

      let createdActions: { action_code: string; action_type: string; item_name: string | null; priority: string }[] = [];
      if (toInsert.length > 0) {
        const { data, error } = await admin
          .from('actions')
          .insert(toInsert)
          .select('action_code, action_type, item_name, priority');
        if (error) throw error;
        createdActions = (data ?? []) as typeof createdActions;
      }

      for (const u of boxItemUpdates) {
        await admin.from('box_items').update(u.patch).eq('id', u.id);
      }

      const summary = {
        ok: itemLines.filter((l) => l.item_status === 'OK').length,
        low_qty: itemLines.filter((l) => l.item_status === 'Low Qty').length,
        missing: itemLines.filter((l) => l.item_status === 'Missing').length,
        expired: itemLines.filter((l) => l.item_status === 'Expired').length,
        actions_created: createdActions.length,
      };

      return jsonOk(
        {
          ok: true,
          inspection_id: inspectionId,
          overall_status: overall,
          item_check_performed: itemCheckPerformed,
          summary,
          actions: createdActions,
        },
        201,
      );
    } catch (err) {
      console.error('[inspections] post-insert failure, rolling back:', err);
      await admin.from('actions').delete().eq('inspection_id', inspectionId);
      await admin.from('inspections').delete().eq('id', inspectionId);
      throw new ApiError(500, 'inspection_failed', 'Could not complete the inspection submission.');
    }
  });
}
