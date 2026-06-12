// POST /api/cloudinary-signature - hand the browser a short-lived signature so
// it can upload directly to Cloudinary WITHOUT ever seeing the API secret.
//   - inspection photos:     public QR inspection flow
//   - item reference photos: admin only
// The upload folder is fixed server-side; the client cannot choose it.

import { requireActive, requireRole } from '@/lib/auth';
import { badRequest, jsonOk, safe } from '@/lib/http';
import { signUpload } from '@/lib/cloudinary';
import { ALLOWED_IMAGE_FORMATS } from '@/lib/logic/cloudinary-url.ts';
import { cloudinarySignatureSchema, FOLDER_BY_UPLOAD_TYPE, firstZodMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return safe(async () => {
    const parsed = cloudinarySignatureSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw badRequest(firstZodMessage(parsed.error));

    const { upload_type } = parsed.data;

    // Authorize per upload type BEFORE issuing a signature.
    if (upload_type === 'item_reference') {
      const ctx = await requireActive();
      requireRole(ctx, ['admin']);
    }

    const folder = FOLDER_BY_UPLOAD_TYPE[upload_type];
    const signed = signUpload(folder);

    return jsonOk({
      ...signed,
      // Hints for the client uploader (also re-validated when the resulting
      // URL is saved, via isAllowedCloudinaryUrl).
      allowed_formats: ALLOWED_IMAGE_FORMATS,
    });
  });
}
