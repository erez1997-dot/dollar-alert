// Draws the app icon (a falling rate line over its dashed average) and writes PNGs, no dependencies.
//   node scripts/make-icons.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../icons/', import.meta.url);
const SAMPLES = 4; // supersampling per axis for anti-aliasing

const line = [[0.16, 0.34], [0.36, 0.47], [0.52, 0.4], [0.8, 0.64]];
const average = 0.45;
const top = [21, 128, 72];
const bottom = [8, 72, 42];

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function shade(u, v) {
  let color = top.map((c, i) => c + (bottom[i] - c) * v);
  const mix = (target, alpha) => (color = color.map((c, i) => c + (target[i] - c) * alpha));

  const dashOn = Math.floor((u - 0.12) / 0.06) % 2 === 0;
  if (u > 0.12 && u < 0.88 && dashOn && Math.abs(v - average) < 0.012) mix([255, 255, 255], 0.35);

  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segmentDistance(u, v, line[i], line[i + 1]));
  if (d < 0.032) mix([255, 255, 255], 1);

  const [ex, ey] = line.at(-1);
  const r = Math.hypot(u - ex, v - ey);
  if (r < 0.085) mix([255, 255, 255], 1);
  if (r < 0.05) mix([120, 235, 160], 1);
  return color;
}

function render(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = shade((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
          for (let i = 0; i < 3; i++) sum[i] += c[i];
        }
      }
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[offset + i] = Math.round(sum[i] / (SAMPLES * SAMPLES));
    }
  }
  return png(size, raw);
}

function png(size, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

await mkdir(OUT, { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await writeFile(new URL(name, OUT), render(size));
}
console.log('Icons written to icons/');
