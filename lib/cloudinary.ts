// =============================================================================
// Cloudinary signed-upload helper. The browser never sees the API secret: it
// asks an authenticated route for a short-lived signature, then uploads the
// (already compressed, EXIF-stripped) image straight to Cloudinary with that
// signature. The secret is used only here, server-side, via node:crypto.
// =============================================================================

import { createHash } from 'node:crypto';
import { PUBLIC_ENV, SERVER_ENV } from '@/lib/env';

export interface SignedUpload {
  timestamp: number;
  signature: string;
  api_key: string;
  cloud_name: string;
  folder: string;
}

/**
 * Produce signed upload params restricted to `folder`. Cloudinary's signed
 * upload algorithm: sha1 of the alphabetically-sorted "key=value" params that
 * the client will send (here: folder, timestamp) concatenated with the secret.
 * The client MUST upload with exactly these params, or Cloudinary rejects it.
 */
export function signUpload(folder: string): SignedUpload {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash('sha1')
    .update(paramsToSign + SERVER_ENV.cloudinaryApiSecret())
    .digest('hex');

  return {
    timestamp,
    signature,
    api_key: SERVER_ENV.cloudinaryApiKey(),
    cloud_name: PUBLIC_ENV.cloudinaryCloudName(),
    folder,
  };
}
