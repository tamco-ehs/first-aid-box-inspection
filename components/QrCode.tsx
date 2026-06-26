'use client';

import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

// Renders a real, scannable QR code for `value` (a URL) with download + print.
// Uses error-correction level "M" and a quiet-zone margin so phone cameras read
// it reliably even when printed and stuck on a box.
export function QrCode({
  value,
  label,
  filename,
  size = 168,
}: {
  value: string;
  label: string;
  filename: string;
  size?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  function getCanvas(): HTMLCanvasElement | null {
    return wrapRef.current?.querySelector('canvas') ?? null;
  }

  function download() {
    const canvas = getCanvas();
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function print() {
    const canvas = getCanvas();
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(
      `<title>${label}</title><body style="font-family:system-ui;text-align:center;padding:24px">` +
        `<h2 style="margin:0 0 12px">${label}</h2>` +
        `<img src="${dataUrl}" style="width:280px;height:280px"/>` +
        `<p style="font-size:12px;color:#555;word-break:break-all">${value}</p>` +
        `<script>window.onload=function(){window.print()}</script></body>`,
    );
    w.document.close();
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={wrapRef} className="rounded-xl border border-slate-200 bg-white p-2">
        <QRCodeCanvas value={value} size={size} level="M" marginSize={2} />
      </div>
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <div className="flex gap-2">
        <button onClick={download} className="btn btn-md btn-secondary">
          Download
        </button>
        <button onClick={print} className="btn btn-md btn-secondary">
          Print
        </button>
      </div>
    </div>
  );
}
