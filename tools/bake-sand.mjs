// Bakes render3d.js _sandTexture (wind ripples + grain, tileable, mulberry(77))
// into assets/sand-<n>.png for each preset size (128, 256, 512): its
// per-pixel loop is far too slow for the engine's interpreter at load. Run
// once; the PNGs are committed.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(n, grey) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(n * (n * 3 + 1));
  for (let y = 0; y < n; y++) {
    raw[y * (n * 3 + 1)] = 0;
    for (let x = 0; x < n; x++) { const v = grey[y * n + x], o = y * (n * 3 + 1) + 1 + x * 3; raw[o] = raw[o + 1] = raw[o + 2] = v; }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
for (const n of [128, 256, 512]) {
  const grey = new Uint8ClampedArray(n * n);
  const rnd = mulberry(77);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n;
    const warp = Math.sin(u * Math.PI * 2 * 2) * 0.3 + Math.sin((u + v) * Math.PI * 2 * 3) * 0.12;
    const rip = Math.pow(Math.sin((v * 7 + warp) * Math.PI * 2) * 0.5 + 0.5, 3);
    const val = 0.92 + rip * 0.045 + (rnd() - 0.5) * 0.07;
    grey[y * n + x] = Math.max(0, Math.min(255, val * 255));
  }
  writeFileSync(join(root, 'assets', `sand-${n}.png`), png(n, grey));
}
console.log('wrote assets/sand-{128,256,512}.png');
