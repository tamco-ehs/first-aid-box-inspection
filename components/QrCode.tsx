'use client';

import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

type QrPurpose = 'inspection' | 'usage';

const PURPOSE: Record<QrPurpose, { title: string; action: string; audience: string; accent: string; soft: string }> = {
  inspection: {
    title: 'Inspection QR',
    action: 'Scan to start inspection',
    audience: 'First Aider Only',
    accent: '#15803d',
    soft: '#ecfdf5',
  },
  usage: {
    title: 'Usage QR',
    action: 'Scan to record item usage',
    audience: 'All Staff',
    accent: '#0f766e',
    soft: '#f0fdfa',
  },
};

// Renders a real, scannable QR code for `value` (a URL) with corporate label
// download + print. The QR stays plain black/white for camera reliability.
export function QrCode({
  value,
  label,
  filename,
  boxCode,
  boxName,
  location,
  area,
  purpose,
  size = 184,
}: {
  value: string;
  label: string;
  filename: string;
  boxCode?: string;
  boxName?: string;
  location?: string;
  area?: string | null;
  purpose?: QrPurpose;
  size?: number;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const meta = purpose ? PURPOSE[purpose] : PURPOSE.inspection;

  function getCanvas(): HTMLCanvasElement | null {
    return sourceRef.current?.querySelector('canvas') ?? previewRef.current?.querySelector('canvas') ?? null;
  }

  function makeLabelDataUrl(): string | null {
    const qr = getCanvas();
    if (!qr) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    drawLabel(ctx, {
      qr,
      value,
      label,
      boxCode: boxCode ?? 'BOX',
      boxName: boxName ?? '',
      location: location ?? '',
      area: area ?? '',
      meta,
    });
    return canvas.toDataURL('image/png');
  }

  function download() {
    const dataUrl = makeLabelDataUrl();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function print() {
    const dataUrl = makeLabelDataUrl();
    if (!dataUrl) return;
    const w = window.open('', '_blank', 'width=620,height=760');
    if (!w) return;
    w.document.write(
      `<title>${escapeAttr(boxCode ?? label)} ${escapeAttr(meta.title)}</title>` +
        `<body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">` +
        `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box">` +
        `<img src="${dataUrl}" style="width:100%;max-width:420px;height:auto;border:1px solid #d9e2ec;background:#fff"/>` +
        `</div>` +
        `<script>window.onload=function(){window.print()}</script></body>`,
    );
    w.document.close();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand">Tamco EHS</p>
          <p className="text-sm font-bold text-slate-950">{meta.title}</p>
          <p className="text-xs text-slate-500">{meta.audience}</p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase" style={{ backgroundColor: meta.soft, color: meta.accent }}>
          {boxCode ?? 'Box'}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[auto,1fr] sm:items-center">
        <div ref={previewRef} className="mx-auto rounded-xl border border-slate-200 bg-white p-2">
          <QRCodeCanvas value={value} size={size} level="Q" marginSize={3} />
        </div>
        <div className="min-w-0 text-center sm:text-left">
          <p className="text-base font-bold text-slate-950">{boxName ?? label}</p>
          <p className="mt-1 text-sm font-semibold" style={{ color: meta.accent }}>
            {meta.action}
          </p>
          <p className="mt-1 text-xs text-slate-500">{[location, area].filter(Boolean).join(' - ')}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button onClick={download} className="btn btn-md btn-secondary">
          Download label
        </button>
        <button onClick={print} className="btn btn-md btn-secondary">
          Print label
        </button>
      </div>
      <div ref={sourceRef} className="pointer-events-none fixed -left-[9999px] top-0 opacity-0" aria-hidden>
        <QRCodeCanvas value={value} size={640} level="Q" marginSize={4} />
      </div>
    </div>
  );
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  opts: {
    qr: HTMLCanvasElement;
    value: string;
    label: string;
    boxCode: string;
    boxName: string;
    location: string;
    area: string;
    meta: { title: string; action: string; audience: string; accent: string; soft: string };
  },
) {
  const { qr, value, boxCode, boxName, location, area, meta } = opts;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 1200);

  ctx.fillStyle = meta.accent;
  ctx.fillRect(0, 0, 900, 22);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 22, 900, 126);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px Arial, Helvetica, sans-serif';
  ctx.fillText('TAMCO EHS', 64, 78);
  ctx.font = '800 42px Arial, Helvetica, sans-serif';
  ctx.fillText('FIRST AID BOX', 64, 126);

  ctx.fillStyle = meta.accent;
  roundRect(ctx, 64, 182, 772, 92, 20);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 30px Arial, Helvetica, sans-serif';
  ctx.fillText(meta.title.toUpperCase(), 94, 220);
  ctx.font = '700 22px Arial, Helvetica, sans-serif';
  ctx.fillText(meta.audience.toUpperCase(), 94, 252);

  ctx.fillStyle = '#0f172a';
  ctx.font = '900 72px Arial, Helvetica, sans-serif';
  fitText(ctx, boxCode, 64, 360, 772);

  ctx.font = '700 30px Arial, Helvetica, sans-serif';
  wrapText(ctx, boxName || opts.label, 64, 410, 772, 36, 2);
  ctx.fillStyle = '#475569';
  ctx.font = '500 24px Arial, Helvetica, sans-serif';
  wrapText(ctx, [location, area].filter(Boolean).join(' - '), 64, 490, 772, 30, 2);

  ctx.strokeStyle = '#dbe5ef';
  ctx.lineWidth = 3;
  roundRect(ctx, 165, 562, 570, 570, 28);
  ctx.stroke();
  ctx.drawImage(qr, 195, 592, 510, 510);

  ctx.fillStyle = meta.accent;
  ctx.font = '900 34px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(meta.action.toUpperCase(), 450, 1146);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#64748b';
  ctx.font = '500 18px Arial, Helvetica, sans-serif';
  const host = safeHost(value);
  if (host) {
    ctx.textAlign = 'center';
    ctx.fillText(host, 450, 1178);
    ctx.textAlign = 'left';
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(lines === maxLines - 1 ? truncate(ctx, line, maxWidth) : line, x, y + lines * lineHeight);
      lines += 1;
      line = word;
      if (lines >= maxLines) return;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(truncate(ctx, line, maxWidth), x, y + lines * lineHeight);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  let fontSize = 72;
  while (ctx.measureText(text).width > maxWidth && fontSize > 38) {
    fontSize -= 2;
    ctx.font = `900 ${fontSize}px Arial, Helvetica, sans-serif`;
  }
  ctx.fillText(text, x, y);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}...`;
}

function safeHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
