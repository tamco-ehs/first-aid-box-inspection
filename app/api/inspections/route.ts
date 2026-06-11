// POST /api/inspections - submit a first aid box inspection.
//
// Security (all server-side, never trusting the client):
//   1. authenticated + active                          (requireActive)
//   2. role is admin or first_aider                    (requireRole)
//   3. box exists and is active                        (DB lookup)
//   4. caller may write this box                       (requireBoxAccess)
//   5. box photo is one of OUR Cloudinary URLs         (isAllowedCloudinaryUrl)
//   6. every submitted item belongs to this box        (spec map lookup)
//   7. each observation is valid for its measure type  (validateObservation)
//
// All item statuses and the overall verdict are RECOMPUTED here from the stored
// box_items spec - values sent by the client are ignored. Writes go through the
// service-role client (top-ups and box-item state are admin-only under RLS);
// the inspector identity is still pinned to auth.uid() and re-snapshotted by a
// DB trigger. On any post-insert failure the inspection is rolled back so the
// operation is atomic.

import { ApiError, badRequest, jsonOk, notFound, safe } from '@/lib/http';
import { requireActive, requireBoxAccess, requireRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_ENV, SERVER_ENV } from '@/lib/env';
import { buildTopupEmail, sendEmail } from '@/lib/email';
import { INSPECTION_PHOTO_FOLDER, isAllowedCloudinaryUrl } from '@/lib/logic/cloudinary-url.ts';
import {
  computeOverallStatus,
  evaluateItem,
  getExpiryReminderStatus,
  summarize,
  validateObservation,
} from '@/lib/logic/inspection.ts';
import { buildTopupRows, topupKey } from '@/lib/logic/topup.ts';
import type { BoxItemSpec, EvaluatedItem, Observation } from '@/lib/logic/types.ts';
import { inspectionSubmitSchema, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SpecRow {
  id: string;
  item_name: string;
  measurement_type: BoxItemSpec['measurement_type'];
  required_quantity: number | null;
  unit: string | null;
  has_expiry: boolean;
  expiry_date: string | null;
  expiry_status: string | null;
  expiry_warning_days: number | null;
  is_critical: boolean;
  restock_threshold_type: BoxItemSpec['restock_threshold_type'];
  restock_threshold_quantity: number | null;
}

interface BoxRow {
  id: string;
  is_active: boolean;
  box_code: string | null;
  box_name: string;
  location_description: string;
}

export async function POST(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['admin', 'first_aider']);

    const parsed = inspectionSubmitSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const body = parsed.data;

    const admin = createAdminClient();

    // 3. box exists + active
    const { data: box } = await admin
      .from('boxes')
      .select('id, is_active, box_code, box_name, location_description')
      .eq('id', body.box_id)
      .maybeSingle();
    const boxRow = box as BoxRow | null;
    if (!boxRow || !boxRow.is_active) {
      throw notFound('First aid box not found or inactive.');
    }

    // 4. caller may write this box (admin: any; first_aider: assigned only)
    await requireBoxAccess(ctx, body.box_id, { write: true });

    // 5. box photo must be a real upload in our inspection folder
    if (
      !isAllowedCloudinaryUrl(body.box_photo_url, PUBLIC_ENV.cloudinaryCloudName(), [
        INSPECTION_PHOTO_FOLDER,
      ])
    ) {
      throw badRequest('A valid box inspection photo is required.');
    }

    // load the box's checklist spec (template values via the effective view)
    const { data: specsData } = await admin
      .from('box_items_effective')
      .select(
        'id, item_name, measurement_type, required_quantity, unit, has_expiry, expiry_date, expiry_status, expiry_warning_days, is_critical, restock_threshold_type, restock_threshold_quantity',
      )
      .eq('box_id', body.box_id)
      .eq('is_active', true);

    const specByItemId = new Map<string, SpecRow>();
    for (const s of (specsData ?? []) as SpecRow[]) specByItemId.set(s.id, s);
    if (specByItemId.size === 0) throw badRequest('This box has no checklist items configured.');

    // 6 + 7. validate every submitted line, then evaluate server-side
    const now = new Date();
    const lines: {
      ev: EvaluatedItem;
      obs: Observation;
      spec: SpecRow;
      remarks: string | null;
      unit: string | null;
    }[] = [];
    const seen = new Set<string>();

    for (const sub of body.inspection_items) {
      const spec = specByItemId.get(sub.box_item_id);
      if (!spec) throw badRequest('A submitted item does not belong to this box.');
      if (seen.has(sub.box_item_id)) throw badRequest('Duplicate item in submission.');
      seen.add(sub.box_item_id);

      if (
        sub.replacement_photo_url &&
        !isAllowedCloudinaryUrl(sub.replacement_photo_url, PUBLIC_ENV.cloudinaryCloudName(), [
          INSPECTION_PHOTO_FOLDER,
        ])
      ) {
        throw badRequest(`"${spec.item_name}": replacement photo must be a valid inspection upload.`);
      }

      const itemSpec: BoxItemSpec = {
        box_item_id: spec.id,
        item_name: spec.item_name,
        measurement_type: spec.measurement_type,
        required_quantity: spec.required_quantity,
        has_expiry: spec.has_expiry,
        current_expiry_date: spec.expiry_date,
        expiry_warning_days: spec.expiry_warning_days,
        is_critical: spec.is_critical,
        restock_threshold_type: spec.restock_threshold_type,
        restock_threshold_quantity: spec.restock_threshold_quantity,
      };
      const obs: Observation = {
        observed_quantity: sub.observed_quantity ?? null,
        observed_volume_level: sub.observed_volume_level ?? null,
        observed_present_status: sub.observed_present_status ?? null,
        expiry_date: sub.expiry_date ?? null,
        expiry_validation_status: sub.expiry_validation_status ?? null,
        replacement_date: sub.replacement_date ?? null,
        replacement_photo_url: sub.replacement_photo_url ?? null,
        replacement_photo_cloudinary_public_id: sub.replacement_photo_cloudinary_public_id ?? null,
        remarks: sub.remarks ?? null,
      };

      const validationError = validateObservation(itemSpec, obs);
      if (validationError) throw badRequest(validationError);

      lines.push({
        ev: evaluateItem(itemSpec, obs, now),
        obs,
        spec,
        remarks: sub.remarks ?? null,
        unit: spec.unit,
      });
    }

    const evaluated = lines.map((l) => l.ev);
    // Box photo is guaranteed present (schema + URL check), so pass true.
    const overall = computeOverallStatus(evaluated, true);

    // ---- writes (service role); roll back the inspection on any failure ------
    const userAgent = req.headers.get('user-agent')?.slice(0, 400) ?? null;

    const { data: inspIns, error: inspErr } = await admin
      .from('inspections')
      .insert({
        box_id: body.box_id,
        inspector_id: ctx.userId, // pinned to the caller; trigger re-snapshots name/dept
        inspector_name: ctx.profile.full_name,
        inspector_department: ctx.profile.department,
        overall_status: overall,
        box_photo_url: body.box_photo_url,
        box_photo_cloudinary_public_id: body.box_photo_cloudinary_public_id ?? null,
        notes: body.notes ?? null,
        submitted_device: body.submitted_device ?? null,
        submitted_user_agent: userAgent,
      })
      .select('id')
      .single();

    if (inspErr || !inspIns) {
      console.error('[inspections] header insert failed:', inspErr?.message);
      throw new ApiError(500, 'inspection_failed', 'Could not save the inspection.');
    }
    const inspectionId = (inspIns as { id: string }).id;

    try {
      // inspection_items
      const lineRows = lines.map((l) => ({
        inspection_id: inspectionId,
        box_item_id: l.ev.box_item_id,
        item_name: l.ev.item_name,
        required_quantity: l.ev.required_quantity,
        observed_quantity: l.ev.observed_quantity,
        unit: l.unit,
        measurement_type: l.ev.measurement_type,
        observed_volume_level: l.ev.observed_volume_level,
        observed_present_status: l.ev.observed_present_status,
        expiry_date: l.ev.expiry_date,
        system_expiry_date: l.ev.system_expiry_date,
        expiry_validation_status: l.ev.expiry_validation_status,
        expiry_label_mismatch: l.ev.expiry_label_mismatch,
        no_expiry_date_recorded: l.ev.no_expiry_date_recorded,
        item_status: l.ev.item_status,
        is_below_half: l.ev.is_below_half,
        is_expired: l.ev.is_expired,
        expires_soon: l.ev.expires_soon,
        topup_required: l.ev.topup_required,
        remarks: l.remarks,
      }));

      const { data: insertedItems, error: itemsErr } = await admin
        .from('inspection_items')
        .insert(lineRows)
        .select('id, box_item_id');
      if (itemsErr) throw itemsErr;

      const itemIdByBoxItem = new Map<string, string>();
      for (const r of (insertedItems ?? []) as { id: string; box_item_id: string }[]) {
        itemIdByBoxItem.set(r.box_item_id, r.id);
      }

      // existing OPEN/IN PROGRESS top-ups for this box -> de-dup keys
      const { data: openTopups } = await admin
        .from('topup_requests')
        .select('item_name')
        .eq('box_id', body.box_id)
        .in('status', ['Open', 'In Progress']);
      const existingOpenKeys = new Set(
        ((openTopups ?? []) as { item_name: string }[]).map((t) => topupKey(t.item_name)),
      );

      const topupRows = buildTopupRows({
        boxId: body.box_id,
        inspectionId,
        requestedBy: ctx.userId,
        lines: lines.map((l) => ({
          evaluated: l.ev,
          inspectionItemId: itemIdByBoxItem.get(l.ev.box_item_id) ?? null,
        })),
        existingOpenKeys,
      });

      if (topupRows.length > 0) {
        const { error: topupErr } = await admin.from('topup_requests').insert(topupRows);
        if (topupErr) throw topupErr;

        const adminEmail = SERVER_ENV.adminNotificationEmail();
        if (adminEmail) {
          const mail = buildTopupEmail({
            boxCode: boxRow.box_code,
            boxName: boxRow.box_name,
            location: boxRow.location_description,
            inspectorName: ctx.profile.full_name,
            overallStatus: overall,
            boxId: body.box_id,
            items: topupRows.map((r) => ({
              itemName: r.item_name,
              priority: r.priority,
              reason: r.reason,
              requiredQuantity: r.required_quantity,
              observedQuantity: r.observed_quantity,
              observedVolumeLevel: r.observed_volume_level,
              expiryDate: r.expiry_date,
            })),
          });
          const emailResult = await sendEmail({
            to: [adminEmail],
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          });
          if (!emailResult.ok) {
            console.error('[inspections] top-up email failed:', emailResult.error);
          }
        } else {
          console.warn('[inspections] top-up email skipped: ADMIN_NOTIFICATION_EMAIL is not set.');
        }
      }

      // update each box item's last-known state and expiry verification metadata
      for (const l of lines) {
        const patch: Record<string, unknown> = {};
        if (l.ev.measurement_type === 'quantity') patch.current_quantity = l.ev.observed_quantity;
        if (l.ev.measurement_type === 'volume_level')
          patch.current_volume_level = l.ev.observed_volume_level;
        if (l.ev.measurement_type === 'present_absent')
          patch.current_present_status = l.ev.observed_present_status;

        if (l.spec.has_expiry) {
          const expiryChoice = l.obs.expiry_validation_status ?? null;
          const newExpiry = l.obs.expiry_date ?? null;
          const oldExpiry = l.spec.expiry_date ?? null;
          const nowIso = now.toISOString();
          const today = nowIso.slice(0, 10);

          if (expiryChoice === 'matches_label') {
            patch.last_verified_date = nowIso;
            patch.last_verified_by = ctx.userId;
            patch.expiry_status =
              getExpiryReminderStatus(true, oldExpiry, l.spec.expiry_warning_days, l.spec.expiry_status, now) ?? 'Valid';
          }

          if (expiryChoice === 'different_date' && newExpiry) {
            patch.expiry_date = newExpiry;
            patch.last_verified_date = nowIso;
            patch.last_verified_by = ctx.userId;
            patch.remarks = l.remarks;
            patch.expiry_status = getExpiryReminderStatus(true, newExpiry, l.spec.expiry_warning_days, null, now) ?? 'Valid';
            const { error: auditErr } = await admin.from('expiry_audit_logs').insert({
              box_id: body.box_id,
              box_item_id: l.ev.box_item_id,
              old_expiry_date: oldExpiry,
              new_expiry_date: newExpiry,
              changed_by: ctx.userId,
              reason: l.remarks,
              source: 'inspection_correction',
            });
            if (auditErr) throw auditErr;
          }

          if (expiryChoice === 'no_label') {
            patch.last_verified_date = nowIso;
            patch.last_verified_by = ctx.userId;
            patch.remarks = l.remarks;
            patch.expiry_status = 'Expiry label mismatch';
          }

          if (expiryChoice === 'expired') {
            patch.last_verified_date = nowIso;
            patch.last_verified_by = ctx.userId;
            patch.remarks = l.remarks;
            patch.expiry_status = 'Expired';
          }

          if (expiryChoice === 'missing_not_replaced') {
            patch.last_verified_date = nowIso;
            patch.last_verified_by = ctx.userId;
            patch.remarks = l.remarks;
          }

          if (expiryChoice === 'replaced_now' && newExpiry) {
            patch.expiry_date = newExpiry;
            patch.last_replaced_date = l.obs.replacement_date ?? today;
            patch.last_replaced_by = ctx.userId;
            patch.last_verified_date = nowIso;
            patch.last_verified_by = ctx.userId;
            patch.remarks = l.remarks ?? null;
            patch.expiry_status = getExpiryReminderStatus(true, newExpiry, l.spec.expiry_warning_days, null, now) ?? 'Valid';
            patch.replacement_photo_url = l.obs.replacement_photo_url ?? null;
            patch.replacement_photo_cloudinary_public_id = l.obs.replacement_photo_cloudinary_public_id ?? null;
            const { error: auditErr } = await admin.from('expiry_audit_logs').insert({
              box_id: body.box_id,
              box_item_id: l.ev.box_item_id,
              old_expiry_date: oldExpiry,
              new_expiry_date: newExpiry,
              changed_by: ctx.userId,
              reason: l.remarks,
              source: 'replacement',
              replacement_photo_url: l.obs.replacement_photo_url ?? null,
              replacement_photo_cloudinary_public_id: l.obs.replacement_photo_cloudinary_public_id ?? null,
            });
            if (auditErr) throw auditErr;
          }
        }

        if (Object.keys(patch).length > 0) {
          const { error: patchErr } = await admin.from('box_items').update(patch).eq('id', l.ev.box_item_id);
          if (patchErr) throw patchErr;
        }
      }

      return jsonOk(
        {
          ok: true,
          inspection_id: inspectionId,
          overall_status: overall,
          summary: summarize(evaluated),
          topups_created: topupRows.length,
          topup_items: topupRows.map((r) => ({
            item_name: r.item_name,
            priority: r.priority,
            reason: r.reason,
          })),
        },
        201,
      );
    } catch (err) {
      // Compensating rollback keeps the submission atomic.
      console.error('[inspections] post-insert failure, rolling back:', err);
      await admin.from('topup_requests').delete().eq('inspection_id', inspectionId);
      await admin.from('inspections').delete().eq('id', inspectionId); // cascades items
      throw new ApiError(500, 'inspection_failed', 'Could not complete the inspection submission.');
    }
  });
}
