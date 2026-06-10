'use client';

import { useRef, useState } from 'react';
import { compressImage, formatBytes } from '@/lib/client/compress.ts';
import { uploadInspectionPhoto } from '@/lib/client/cloudinary.ts';
import { Spinner } from '@/components/Spinner';

type Phase = 'idle' | 'compressing' | 'uploading' | 'done' | 'error';

// Captures exactly ONE live photo of the box (rear camera encouraged via
// capture="environment"), compresses it on-device (<=~150 KB, EXIF stripped),
// uploads to Cloudinary, and reports the resulting URL to the parent.
export function PhotoCapture({
  initialUrl = null,
  onChange,
  disabled,
}: {
  initialUrl?: string | null;
  onChange: (photo: { url: string; publicId: string } | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(initialUrl ? 'done' : 'idle');
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [info, setInfo] = useState<{ bytes: number; w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    onChange(null); // invalidate any previous photo until this one finishes
    setPhase('compressing');
    try {
      const result = await compressImage(file, { maxWidth: 1024, targetBytes: 150 * 1024 });
      setPreview(result.previewUrl);
      setInfo({ bytes: result.bytes, w: result.width, h: result.height });

      setPhase('uploading');
      const uploaded = await uploadInspectionPhoto(result.blob);
      onChange(uploaded);
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Could not process the photo.');
      onChange(null);
    }
  }

  const busy = phase === 'compressing' || phase === 'uploading';

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Take a live photo of the first aid box.</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
        disabled={disabled || busy}
      />

      {preview && (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Box photo preview" className="max-h-72 w-full object-contain bg-slate-50" />
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        {phase === 'done' && <span className="font-medium text-emerald-700">✓ Photo ready</span>}
        {busy && (
          <span className="flex items-center gap-2 text-slate-600">
            <Spinner className="h-4 w-4" />
            {phase === 'compressing' ? 'Compressing…' : 'Uploading…'}
          </span>
        )}
        {info && phase === 'done' && (
          <span className="text-slate-500">
            {formatBytes(info.bytes)} · {info.w}×{info.h}px
          </span>
        )}
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        className="btn btn-lg btn-secondary w-full"
      >
        {preview ? 'Retake photo' : 'Take photo'}
      </button>
    </div>
  );
}
