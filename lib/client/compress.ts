'use client';

// Canvas-based image compression for the live box photo. Re-encoding through a
// canvas also STRIPS EXIF/GPS metadata. Targets <= ~150 KB by stepping quality
// down and then shrinking dimensions. Orientation is corrected via
// createImageBitmap({ imageOrientation: 'from-image' }) where supported.

export interface CompressResult {
  blob: Blob;
  previewUrl: string; // object URL for <img>; revoke when done
  width: number;
  height: number;
  bytes: number;
  type: string;
}

export interface CompressOptions {
  maxWidth?: number; // default 1024
  targetBytes?: number; // default 150 KB
}

function supportsWebp(): boolean {
  try {
    const c = document.createElement('canvas');
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

async function loadBitmap(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      };
    } catch {
      /* fall through to HTMLImageElement */
    }
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read the image.'));
    el.src = url;
  });
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    close: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed.'))), type, quality);
  });
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
  const maxWidth = opts.maxWidth ?? 1024;
  const targetBytes = opts.targetBytes ?? 150 * 1024;
  const type = supportsWebp() ? 'image/webp' : 'image/jpeg';

  const src = await loadBitmap(file);
  try {
    let width = Math.min(maxWidth, src.width || maxWidth);
    let best: { blob: Blob; w: number; h: number } | null = null;

    for (let dimStep = 0; dimStep < 6; dimStep++) {
      const scale = width / (src.width || width);
      const height = Math.max(1, Math.round((src.height || width) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported on this device.');
      src.draw(ctx, width, height);

      for (let q = 0.82; q >= 0.4; q -= 0.12) {
        const blob = await canvasToBlob(canvas, type, q);
        best = { blob, w: width, h: height };
        if (blob.size <= targetBytes) {
          return finalize(best, type);
        }
      }

      width = Math.round(width * 0.82);
      if (width < 320) break;
    }

    // Best effort even if still above target (e.g. very detailed photo).
    return finalize(best!, type);
  } finally {
    src.close();
  }
}

function finalize(best: { blob: Blob; w: number; h: number }, type: string): CompressResult {
  return {
    blob: best.blob,
    previewUrl: URL.createObjectURL(best.blob),
    width: best.w,
    height: best.h,
    bytes: best.blob.size,
    type,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
