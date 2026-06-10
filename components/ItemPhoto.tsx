'use client';

import { useState } from 'react';

// Item reference photo thumbnail. Tap to enlarge in a lightbox. When there is
// no photo, shows a clear placeholder ("No reference photo").
export function ItemPhoto({
  url,
  name,
  className = 'h-16 w-16',
}: {
  url: string | null;
  name: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!url) {
    return (
      <div
        className={`flex ${className} flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-[10px] leading-tight text-slate-400`}
      >
        <span aria-hidden className="text-lg">🩹</span>
        No reference photo
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${className} overflow-hidden rounded-xl border border-slate-200 bg-white`}
        aria-label={`Enlarge photo of ${name}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} loading="lazy" className="h-full w-full object-cover" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={name} className="max-h-[80vh] w-full rounded-xl object-contain" />
            <p className="mt-2 text-center font-medium text-white">{name}</p>
            <button onClick={() => setOpen(false)} className="btn btn-lg btn-secondary mt-3 w-full">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
