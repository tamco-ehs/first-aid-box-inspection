// POST /api/admin/item-photo - admin sets/updates a reference photo on either a
// template item (applies to all boxes using that template) or a single box item
// (per-box override). The URL must be a delivery URL from our Cloudinary
// item-reference folder, or it is rejected.

import { requireActive, requireRole } from '@/lib/auth';
import { badRequest, jsonOk, notFound, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_ENV } from '@/lib/env';
import {
  ITEM_REFERENCE_PHOTO_FOLDER,
  isAllowedCloudinaryUrl,
} from '@/lib/logic/cloudinary-url.ts';
import { itemPhotoSchema, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['admin']);

    const parsed = itemPhotoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));
    const body = parsed.data;

    if (
      !isAllowedCloudinaryUrl(body.item_photo_url, PUBLIC_ENV.cloudinaryCloudName(), [
        ITEM_REFERENCE_PHOTO_FOLDER,
      ])
    ) {
      throw badRequest('Photo URL must be an item-reference image from the approved Cloudinary account.');
    }

    const admin = createAdminClient();
    const patch = {
      item_photo_url: body.item_photo_url,
      item_photo_cloudinary_public_id: body.item_photo_cloudinary_public_id ?? null,
    };

    const table = body.template_item_id ? 'first_aid_kit_template_items' : 'box_items';
    const id = body.template_item_id ?? body.box_item_id!;

    const { data, error } = await admin
      .from(table)
      .update(patch)
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[item-photo] update failed:', error.message);
      throw badRequest('Could not update the item photo.');
    }
    if (!data) throw notFound('Item not found.');

    return jsonOk({ ok: true, target: table, id });
  });
}
