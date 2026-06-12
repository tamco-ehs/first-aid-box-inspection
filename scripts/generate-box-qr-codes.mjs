import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://first-aid-box-inspection.vercel.app').replace(/\/+$/, '');
const outDir = path.join(process.cwd(), 'public', 'qr-codes', 'first-aid-boxes');

const fallbackBoxes = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'FAB-WH-001',
    name: 'Warehouse A First Aid Box',
    area: 'Warehouse',
    location: 'Warehouse A near forklift charging area',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'FAB-PR-001',
    name: 'Production Line 1 First Aid Box',
    area: 'Production',
    location: 'Production hall, line 1, beside supervisor desk',
  },
];

const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const TOTAL_CODEWORDS = [
  -1, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
  1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034,
  3196, 3362, 3532, 3706,
];

const ECL = { index: 1, formatBits: 0 }; // Medium error correction.

async function main() {
  await mkdir(outDir, { recursive: true });
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
  const data = [...Buffer.from(text, 'utf8')];
  let version = 1;
  for (; version <= 40; version++) {
    if (getNumDataCodewords(version) >= getDataCodewordsNeeded(data.length, version)) break;
  }
  if (version > 40) throw new Error(`Text is too long for QR code: ${text}`);

  const bitBuffer = [];
  appendBits(bitBuffer, 0b0100, 4);
  appendBits(bitBuffer, data.length, version <= 9 ? 8 : 16);
  for (const b of data) appendBits(bitBuffer, b, 8);

  const dataCapacityBits = getNumDataCodewords(version) * 8;
  appendBits(bitBuffer, 0, Math.min(4, dataCapacityBits - bitBuffer.length));
  while (bitBuffer.length % 8 !== 0) bitBuffer.push(0);

  const dataCodewords = [];
  for (let i = 0; i < bitBuffer.length; i += 8) {
    dataCodewords.push(Number.parseInt(bitBuffer.slice(i, i + 8).join(''), 2));
  }
  for (let pad = 0xec; dataCodewords.length < getNumDataCodewords(version); pad ^= 0xec ^ 0x11) {
    dataCodewords.push(pad);
  }

  const codewords = addEccAndInterleave(dataCodewords, version);
  const qr = new QrMatrix(version);
  qr.drawFunctionPatterns();
  qr.drawCodewords(codewords);
  qr.applyMask(0);
  qr.drawFormatBits(0);
  return qr;
}

function getDataCodewordsNeeded(byteLength, version) {
  const countBits = version <= 9 ? 8 : 16;
  return Math.ceil((4 + countBits + byteLength * 8 + 4) / 8);
}

function getNumDataCodewords(version) {
  return TOTAL_CODEWORDS[version] - ECC_CODEWORDS_PER_BLOCK[ECL.index][version] * NUM_ERROR_CORRECTION_BLOCKS[ECL.index][version];
}

function appendBits(buffer, value, length) {
  for (let i = length - 1; i >= 0; i--) buffer.push((value >>> i) & 1);
}

function addEccAndInterleave(data, version) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ECL.index][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ECL.index][version];
  const rawCodewords = TOTAL_CODEWORDS[version];
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const generator = reedSolomonGenerator(blockEccLen);
  const blocks = [];

  let offset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(offset, offset + dataLen);
    offset += dataLen;
    const ecc = reedSolomonRemainder(dat, generator);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
    }
  }
  return result;
}

function reedSolomonGenerator(degree) {
  let result = [1];
  for (let i = 0; i < degree; i++) {
    result.push(0);
    for (let j = result.length - 1; j > 0; j--) {
      result[j] = result[j - 1] ^ gfMultiply(result[j], pow2(i));
    }
    result[0] = gfMultiply(result[0], pow2(i));
  }
  return result;
}

function reedSolomonRemainder(data, generator) {
  const result = Array(generator.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= gfMultiply(generator[i], factor);
  }
  return result;
}

function pow2(exp) {
  let value = 1;
  for (let i = 0; i < exp; i++) value = gfMultiply(value, 2);
  return value;
}

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

class QrMatrix {
  constructor(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    this.functionModules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
  }

  setFunctionModule(x, y, value) {
    this.modules[y][x] = value;
    this.functionModules[y][x] = true;
  }

  drawFunctionPatterns() {
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    for (let i = 0; i < this.size; i++) {
      if (!this.functionModules[6][i]) this.setFunctionModule(i, 6, i % 2 === 0);
      if (!this.functionModules[i][6]) this.setFunctionModule(6, i, i % 2 === 0);
    }

    const align = this.alignmentPatternPositions();
    for (const x of align) {
      for (const y of align) {
        if (this.functionModules[y][x]) continue;
        this.drawAlignment(x, y);
      }
    }

    this.setFunctionModule(8, this.size - 8, true);
    this.drawFormatBits(0);
    if (this.version >= 7) this.drawVersionBits();
  }

  drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunctionModule(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  alignmentPatternPositions() {
    if (this.version === 1) return [];
    const numAlign = Math.floor(this.version / 7) + 2;
    const step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  drawCodewords(codewords) {
    let bitIndex = 0;
    let upwards = true;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right--;
      for (let vert = 0; vert < this.size; vert++) {
        const y = upwards ? this.size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (this.functionModules[y][x]) continue;
          const bit = bitIndex < codewords.length * 8 ? ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0 : false;
          this.modules[y][x] = bit;
          bitIndex++;
        }
      }
      upwards = !upwards;
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.functionModules[y][x] && maskCondition(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  drawFormatBits(mask) {
    const bits = getFormatBits(mask);
    for (let i = 0; i < 15; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      if (i < 6) this.setFunctionModule(8, i, bit);
      else if (i < 8) this.setFunctionModule(8, i + 1, bit);
      else this.setFunctionModule(8, this.size - 15 + i, bit);

      if (i < 8) this.setFunctionModule(this.size - 1 - i, 8, bit);
      else if (i < 9) this.setFunctionModule(15 - i, 8, bit);
      else this.setFunctionModule(14 - i, 8, bit);
    }
    this.setFunctionModule(8, this.size - 8, true);
  }

  drawVersionBits() {
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    default:
      return false;
  }
}

function getFormatBits(mask) {
  const data = (ECL.formatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function makeCardSvg({ qr, box, title, actionTitle, actionSubtitle, description, accent, url }) {
  const width = 850;
  const height = 1100;
  const quiet = 4;
  const qrMax = 520;
  const module = Math.floor(qrMax / (qr.size + quiet * 2));
  const qrSize = module * (qr.size + quiet * 2);
  const qrX = Math.round((width - qrSize) / 2);
  const qrY = 390;
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

  <rect x="48" y="918" width="${width - 96}" height="118" rx="20" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/>
  <text x="76" y="956" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="900" fill="#0f172a">${escapeXml(box.code)}</text>
${lines.slice(0, 3).map((line, index) => `  <text x="76" y="${986 + index * 25}" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#334155">${escapeXml(line)}</text>`).join('\n')}

  <text x="${width / 2}" y="1072" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="#64748b">Opens ${escapeXml(domain)}</text>
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
