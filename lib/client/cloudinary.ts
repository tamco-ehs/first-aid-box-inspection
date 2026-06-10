'use client';

// Client-side Cloudinary upload. Flow: ask our API for a short-lived signature
// (auth + role checked server-side), then POST the compressed image straight to
// Cloudinary. The API secret never reaches the browser.

import { api } from './api.ts';

export interface UploadedPhoto {
  url: string;
  publicId: string;
}

async function uploadSigned(
  blob: Blob,
  uploadType: 'inspection' | 'item_reference',
  filename: string,
): Promise<UploadedPhoto> {
  const sig = await api.cloudinarySignature(uploadType);

  const form = new FormData();
  form.append('file', blob, filename);
  form.append('api_key', sig.api_key);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error('Photo upload failed. Please try again.');
  }
  const data = (await res.json()) as { secure_url?: string; public_id?: string };
  if (!data.secure_url || !data.public_id) {
    throw new Error('Photo upload did not complete.');
  }
  return { url: data.secure_url, publicId: data.public_id };
}

export function uploadInspectionPhoto(blob: Blob): Promise<UploadedPhoto> {
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return uploadSigned(blob, 'inspection', `inspection.${ext}`);
}

export function uploadItemReferencePhoto(blob: Blob): Promise<UploadedPhoto> {
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return uploadSigned(blob, 'item_reference', `item.${ext}`);
}
