// One-off generator for the PWA PNG icons (red rounded square + white cross),
// matching public/icons/icon.svg. Uses only Node's zlib (no deps).
//   node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function makePng(size) {
  const bg = [0xdc, 0x26, 0x26];
  const fg = [0xff, 0xff, 0xff];
  const s = size / 512;
  const radius = 96 * s;
  const vbar = { x0: 216 * s, x1: 296 * s, y0: 120 * s, y1: 392 * s };
  const hbar = { x0: 120 * s, x1: 392 * s, y0: 216 * s, y1: 296 * s };

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // rounded-corner transparency
      let inside = true;
      const corners = [
        [radius, radius],
        [size - radius, radius],
        [radius, size - radius],
        [size - radius, size - radius],
      ];
      for (const [cx, cy] of corners) {
        const ox = x < radius || x > size - radius;
        const oy = y < radius || y > size - radius;
        if (ox && oy) {
          const dx = x - cx;
          const dy = y - cy;
          if (Math.hypot(dx, dy) > radius) inside = false;
        }
      }
      const cross =
        (x >= vbar.x0 && x < vbar.x1 && y >= vbar.y0 && y < vbar.y1) ||
        (x >= hbar.x0 && x < hbar.x1 && y >= hbar.y0 && y < hbar.y1);
      const [r, g, b] = cross ? fg : bg;
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = inside ? 255 : 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

mkdirSync(join(root, 'public', 'icons'), { recursive: true });
for (const size of [192, 512]) {
  const out = join(root, 'public', 'icons', `icon-${size}.png`);
  writeFileSync(out, makePng(size));
  console.log(`wrote ${out}`);
}
