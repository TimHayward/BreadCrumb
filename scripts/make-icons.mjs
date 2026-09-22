/**
 * Draws the extension icon: a trail of breadcrumbs falling away to the
 * bottom right, which is the whole idea of the product in one shape.
 *
 * Writes PNGs with Node's zlib rather than an image library, so the build
 * keeps its "no runtime dependencies" habit. Run: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '..', 'packages', 'extension', 'icons');
const SIZES = [16, 32, 48, 128];

/** Crumbs as unit circles: x, y and radius as fractions of the icon. */
const CRUMBS = [
  { x: 0.2, y: 0.22, r: 0.15 },
  { x: 0.45, y: 0.44, r: 0.12 },
  { x: 0.66, y: 0.64, r: 0.095 },
  { x: 0.83, y: 0.82, r: 0.07 },
];

const CRUST = [176, 118, 54]; // a baked crust brown
const CRUMB = [222, 171, 106]; // the lighter inside

const crc32Table = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = crc32Table[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Each row is prefixed with a filter byte, always 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Four samples per axis, so the circles have smooth edges even at 16px. */
const SAMPLES = 4;

function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      let crustHits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x + (sx + 0.5) / SAMPLES) / size;
          const py = (y + (sy + 0.5) / SAMPLES) / size;
          for (const crumb of CRUMBS) {
            const dx = px - crumb.x;
            const dy = py - crumb.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= crumb.r) {
              hits += 1;
              // The outer third is crust, the middle is crumb: enough shape to read at 16px.
              if (distance > crumb.r * 0.62) {
                crustHits += 1;
              }
              break;
            }
          }
        }
      }
      if (hits === 0) {
        continue;
      }
      const total = SAMPLES * SAMPLES;
      const alpha = Math.round((hits / total) * 255);
      const crustShare = crustHits / hits;
      const colour = [0, 1, 2].map((i) => Math.round(CRUMB[i] * (1 - crustShare) + CRUST[i] * crustShare));
      const at = (y * size + x) * 4;
      pixels[at] = colour[0];
      pixels[at + 1] = colour[1];
      pixels[at + 2] = colour[2];
      pixels[at + 3] = alpha;
    }
  }
  return pixels;
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT, `icon-${size}.png`);
  writeFileSync(file, png(size, draw(size)));
  console.log(`wrote ${file}`);
}
