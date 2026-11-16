// 生成 PWA 图标（纯 Node，无依赖）：node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const NAVY = hex('#232C4E'), CREAM = hex('#F4EEE2'), AMBER = hex('#E8930C'), TEAL = hex('#0E9384');

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const ia = a / 255, oa = px[i + 3] / 255, na = ia + oa * (1 - ia);
    if (na <= 0) return;
    px[i] = Math.round((r * ia + px[i] * oa * (1 - ia)) / na);
    px[i + 1] = Math.round((g * ia + px[i + 1] * oa * (1 - ia)) / na);
    px[i + 2] = Math.round((b * ia + px[i + 2] * oa * (1 - ia)) / na);
    px[i + 3] = Math.round(na * 255);
  };
  // 全幅墨蓝底（maskable 安全）
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, NAVY);
  //  subtle 顶部提亮
  for (let y = 0; y < size; y++) {
    const t = Math.max(0, 1 - y / (size * 0.55)) * 0.10;
    if (t <= 0) continue;
    for (let x = 0; x < size; x++) put(x, y, [255, 255, 255], Math.round(t * 255));
  }
  // 4 列 × 3 行课表格，居中 80% 安全区
  const area = size * 0.66, x0 = (size - area) / 2, y0 = (size - area) / 2;
  const cols = 4, rows = 3, gap = area * 0.055;
  const cw = (area - gap * (cols - 1)) / cols, ch = (area - gap * (rows - 1)) / rows;
  const rad = Math.min(cw, ch) * 0.22;
  const inCell = (x, y, cx, cy) => {
    const dx = Math.max(Math.abs(x - (cx + cw / 2)) - (cw / 2 - rad), 0);
    const dy = Math.max(Math.abs(y - (cy + ch / 2)) - (ch / 2 - rad), 0);
    return dx * dx + dy * dy <= rad * rad;
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = x0 + c * (cw + gap), cy = y0 + r * (ch + gap);
    let color = CREAM;
    if (r === 0 && c === 1) color = AMBER;
    if (r === 2 && c === 3) color = TEAL;
    for (let y = Math.floor(cy); y < cy + ch; y++)
      for (let x = Math.floor(cx); x < cx + cw; x++)
        if (inCell(x + 0.5, y + 0.5, cx, cy)) put(x, y, color);
  }
  return px;
}

function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const rx = sw / dw, ry = sh / dh;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx0 = x * rx, sy0 = y * ry, sx1 = sx0 + rx, sy1 = sy0 + ry;
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
      const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
      if (wy <= 0) continue;
      for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
        const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
        if (wx <= 0) continue;
        const w = wx * wy, i = (sy * sw + sx) * 4;
        r += src[i] * w; g += src[i + 1] * w; b += src[i + 2] * w; a += src[i + 3] * w; n += w;
      }
    }
    const o = (y * dw + x) * 4;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
  }
  return out;
}

const big = drawIcon(512);
writeFileSync(join(outDir, 'icon-512.png'), encodePNG(512, 512, big));
writeFileSync(join(outDir, 'icon-192.png'), encodePNG(192, 192, resize(big, 512, 512, 192, 192)));
writeFileSync(join(outDir, 'apple-touch-icon.png'), encodePNG(180, 180, resize(big, 512, 512, 180, 180)));
console.log('icons written: icon-512.png / icon-192.png / apple-touch-icon.png');