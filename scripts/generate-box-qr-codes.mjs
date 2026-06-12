import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';

const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://first-aid-box-inspection.vercel.app').replace(/\/+$/, '');
const outDir = path.join(process.cwd(), 'public', 'qr-codes', 'first-aid-boxes');

const fallbackBoxes = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'REC-01',
    name: 'REC-01 First Aid Box',
    area: 'Office',
    location: 'Reception',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'OFF-01',
    name: 'OFF-01 First Aid Box',
    area: 'Office',
    location: 'Office 1st Floor, Near Lift',
  },
  { id: 'b0000000-0000-4000-8000-000000000003', code: 'OFF-02', name: 'OFF-02 First Aid Box', area: 'Office', location: 'Office 1st Floor, Purchasing' },
  { id: 'b0000000-0000-4000-8000-000000000004', code: 'OFF-03', name: 'OFF-03 First Aid Box', area: 'Office', location: 'Office 2nd Floor, Lift' },
  { id: 'b0000000-0000-4000-8000-000000000005', code: 'OFF-04', name: 'OFF-04 First Aid Box', area: 'Office', location: 'Office 2nd Floor, AE' },
  { id: 'b0000000-0000-4000-8000-000000000006', code: 'PRO-01', name: 'PRO-01 First Aid Box', area: 'Office', location: 'Production Office' },
  { id: 'b0000000-0000-4000-8000-000000000007', code: 'LOA-01', name: 'LOA-01 First Aid Box', area: 'Production', location: 'Loading Area' },
  { id: 'b0000000-0000-4000-8000-000000000008', code: 'VCB-01', name: 'VCB-01 First Aid Box', area: 'Production', location: 'VCB Entrance' },
  { id: 'b0000000-0000-4000-8000-000000000009', code: 'RND-01', name: 'RND-01 First Aid Box', area: 'Production', location: 'R&D Entrance' },
  { id: 'b0000000-0000-4000-8000-000000000010', code: 'RMU-01', name: 'RMU-01 First Aid Box', area: 'Production', location: 'RMU, Inside' },
  { id: 'b0000000-0000-4000-8000-000000000011', code: 'GIS-01', name: 'GIS-01 First Aid Box', area: 'Production', location: 'GIS Walkway' },
  { id: 'b0000000-0000-4000-8000-000000000012', code: 'WIR-01', name: 'WIR-01 First Aid Box', area: 'Production', location: 'Wire Harness Area' },
  { id: 'b0000000-0000-4000-8000-000000000013', code: 'WIR-02', name: 'WIR-02 First Aid Box', area: 'Production', location: 'Wire Assembly' },
  { id: 'b0000000-0000-4000-8000-000000000014', code: 'STO-01', name: 'STO-01 First Aid Box', area: 'Production', location: 'Store' },
  { id: 'b0000000-0000-4000-8000-000000000015', code: 'STO-02', name: 'STO-02 First Aid Box', area: 'Production', location: 'Store Office' },
  { id: 'b0000000-0000-4000-8000-000000000016', code: 'TES-01', name: 'TES-01 First Aid Box', area: 'Production', location: 'Testing Area' },
  { id: 'b0000000-0000-4000-8000-000000000017', code: 'AIS-01', name: 'AIS-01 First Aid Box', area: 'Production', location: 'New AIS Assembly' },
  { id: 'b0000000-0000-4000-8000-000000000018', code: 'AIS-02', name: 'AIS-02 First Aid Box', area: 'Production', location: 'AIS Testing' },
  { id: 'b0000000-0000-4000-8000-000000000019', code: 'FAB-01', name: 'FAB-01 First Aid Box', area: 'Production', location: 'Fabrication Area' },
  { id: 'b0000000-0000-4000-8000-000000000020', code: 'GUA-01', name: 'GUA-01 First Aid Box', area: 'External', location: 'Guard Post 2' },
  { id: 'b0000000-0000-4000-8000-000000000021', code: 'GUA-02', name: 'GUA-02 First Aid Box', area: 'External', location: 'Guard Post 1' },
  { id: 'b0000000-0000-4000-8000-000000000022', code: 'GIS-02', name: 'GIS-02 First Aid Box', area: 'Production', location: 'GIS, Inside' },
  { id: 'b0000000-0000-4000-8000-000000000023', code: 'PAI-01', name: 'PAI-01 First Aid Box', area: 'Production', location: 'Paintshop' },
];

async function main() {
  await mkdir(outDir, { recursive: true });
  await removeOldGeneratedSvgs();
  const boxes = await loadBoxes();
  const generated = [];

  for (const box of boxes) {
    const links = [
      {
        kind: 'inspection',
        label: 'Inspection QR',
        actionTitle: 'INSPECTION',
        actionSubtitle: 'SCAN TO INSPECT THIS BOX',
        description: 'Monthly first aid box checklist',
        accent: '#dc2626',
        url: `${appUrl}/inspect/${box.id}`,
      },
      {
        kind: 'usage',
        label: 'Usage QR',
        actionTitle: 'USAGE LOG',
        actionSubtitle: 'SCAN WHEN TAKING ITEMS',
        description: 'Record first aid items taken',
        accent: '#059669',
        url: `${appUrl}/usage?box=${box.id}&code=${encodeURIComponent(box.code)}`,
      },
    ];

    for (const link of links) {
      const fileName = `${safeName(box.code)}-${link.kind}-qr.svg`;
      const svg = makeCardSvg({
        qr: encodeQr(link.url),
        box,
        title: `${box.code} ${link.label}`,
        actionTitle: link.actionTitle,
        actionSubtitle: link.actionSubtitle,
        description: link.description,
        accent: link.accent,
        url: link.url,
      });
      await writeFile(path.join(outDir, fileName), svg, 'utf8');
      generated.push({ fileName, box: box.code, type: link.kind, label: link.actionTitle, url: link.url });
    }
  }

  await writeFile(path.join(outDir, 'index.html'), makeIndexHtml(generated), 'utf8');
  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(generated, null, 2)}\n`, 'utf8');

  for (const item of generated) {
    console.log(`${item.box} ${item.type}: public/qr-codes/first-aid-boxes/${item.fileName}`);
  }
}

async function removeOldGeneratedSvgs() {
  for (const fileName of await readdir(outDir)) {
    if (fileName.endsWith('-qr.svg')) await unlink(path.join(outDir, fileName));
  }
}

async function loadBoxes() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return fallbackBoxes;

  const endpoint =
    `${supabaseUrl}/rest/v1/boxes?select=id,box_code,box_name,location_description,area,is_active` +
    '&is_active=eq.true&order=box_code.asc';
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return fallbackBoxes;
    return rows.map((row) => ({
      id: String(row.id),
      code: String(row.box_code),
      name: String(row.box_name),
      area: row.area ? String(row.area) : '',
      location: row.location_description ? String(row.location_description) : '',
    }));
  } catch (error) {
    console.warn(`Could not load boxes from Supabase; using fallback boxes. ${error instanceof Error ? error.message : ''}`);
    return fallbackBoxes;
  }
}

function encodeQr(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'Q' });
  return {
    size: qr.modules.size,
    modules: Array.from({ length: qr.modules.size }, (_, y) =>
      Array.from({ length: qr.modules.size }, (_, x) => Boolean(qr.modules.get(y, x))),
    ),
  };
}

function makeCardSvg({ qr, box, title, actionTitle, actionSubtitle, description, accent, url }) {
  const width = 850;
  const height = 1240;
  const quiet = 5;
  const qrMax = 610;
  const module = Math.floor(qrMax / (qr.size + quiet * 2));
  const qrSize = module * (qr.size + quiet * 2);
  const qrX = Math.round((width - qrSize) / 2);
  const qrY = 365;
  const detailsY = 1034;
  const pathData = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) {
        pathData.push(`M${qrX + (x + quiet) * module},${qrY + (y + quiet) * module}h${module}v${module}h-${module}z`);
      }
    }
  }

  const lines = [
    ...wrapText(box.name, 48),
    box.area ? `Area: ${box.area}` : '',
    box.location ? `Location: ${box.location}` : '',
  ].filter(Boolean);
  const domain = new URL(url).hostname.replace(/^www\./, '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <rect width="100%" height="100%" rx="34" fill="#ffffff"/>
  <rect x="0" y="0" width="${width}" height="104" rx="34" fill="#0b7fc3"/>
  <text x="58" y="66" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#ffffff">TAMCO</text>
  <text x="${width - 58}" y="50" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#dff4ff">First Aid Box</text>
  <text x="${width - 58}" y="74" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#dff4ff">QR access label</text>

  <rect x="48" y="128" width="${width - 96}" height="142" rx="26" fill="${accent}"/>
  <text x="${width / 2}" y="196" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="900" fill="#ffffff">${escapeXml(actionTitle)}</text>
  <text x="${width / 2}" y="236" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="800" fill="#ffffff">${escapeXml(actionSubtitle)}</text>

  <text x="${width / 2}" y="316" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="900" fill="#0f172a">${escapeXml(box.code)}</text>
  <text x="${width / 2}" y="344" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#475569">${escapeXml(description)}</text>

  <rect x="${qrX - 18}" y="${qrY - 18}" width="${qrSize + 36}" height="${qrSize + 36}" rx="24" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
  <rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" fill="#ffffff"/>
  <path d="${pathData.join('')}" fill="#020617"/>

  <rect x="48" y="${detailsY}" width="${width - 96}" height="118" rx="20" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/>
  <text x="76" y="${detailsY + 38}" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="900" fill="#0f172a">${escapeXml(box.code)}</text>
${lines.slice(0, 3).map((line, index) => `  <text x="76" y="${detailsY + 68 + index * 25}" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#334155">${escapeXml(line)}</text>`).join('\n')}

  <text x="${width / 2}" y="${height - 28}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="#64748b">Opens ${escapeXml(domain)}</text>
</svg>
`;
}

function makeIndexHtml(items) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>First Aid Box QR Codes</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #eef3f8; color: #0f172a; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 18px; }
    h1 { margin: 0 0 6px; }
    p { color: #475569; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; margin-top: 24px; }
    a { display: block; padding: 14px; border: 1px solid #cbd5e1; border-radius: 14px; background: white; color: inherit; text-decoration: none; }
    img { width: 100%; height: auto; border-radius: 12px; }
    strong { display: block; margin-top: 10px; }
    span { color: #64748b; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>First Aid Box QR Codes</h1>
    <p>Print the inspection QR on the inspection record sheet, and the usage QR beside the box for item withdrawal logging.</p>
    <div class="grid">
      ${items.map((item) => `<a href="./${item.fileName}" download><img src="./${item.fileName}" alt="${escapeXml(item.box)} ${escapeXml(item.label)} QR"><strong>${escapeXml(item.label)} - ${escapeXml(item.box)}</strong><span>${escapeXml(item.url)}</span></a>`).join('\n      ')}
    </div>
  </main>
</body>
</html>
`;
}

function wrapText(text, maxLength) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= maxLength) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
