'use client';

import { useRef, useState } from 'react';
import { compressImage } from '@/lib/client/compress.ts';
import { uploadItemReferencePhoto } from '@/lib/client/cloudinary.ts';
import { api } from '@/lib/client/api.ts';
import { Spinner } from '@/components/Spinner';
import { ItemPhoto } from '@/components/ItemPhoto';

// Admin reference-photo uploader for a template item or a box item. Compresses,
// signed-uploads to the item-reference folder, then persists via the admin API
// (which re-validates the Cloudinary URL).
export function ItemPhotoUploader({
  target,
  currentUrl,
  name,
  onChanged,
}: {
  target: { template_item_id?: string; box_item_id?: string };
  currentUrl: string | null;
  name: string;
  onChanged: (url: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(currentUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const compressed = await compressImage(file, { maxWidth: 1024, targetBytes: 200 * 1024 });
      const up = await uploadItemReferencePhoto(compressed.blob);
      await api.setItemPhoto({
        ...target,
        item_photo_url: up.url,
        item_photo_cloudinary_public_id: up.publicId,
      });
      setUrl(up.url);
      onChanged(up.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <ItemPhoto url={url} name={name} className="h-14 w-14" />
      <div>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handle(e.target.files?.[0])}
        />
        <button onClick={() => ref.current?.click()} disabled={busy} className="btn btn-md btn-secondary">
          {busy ? <Spinner className="h-4 w-4" /> : url ? 'Replace photo' : 'Upload photo'}
        </button>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>
    </div>
  );
}
