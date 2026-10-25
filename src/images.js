// Folder artwork (posters, backgrounds, logo) drawn as PNGs with nothing but node:zlib.
// PNG rather than SVG because not every Stremio app can display SVG posters.
'use strict';

const zlib = require('node:zlib');
const { isColor, colorOf } = require('./shared');

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 1; // "Sub" filter: each byte minus the one a pixel to the left; flat areas become zeros
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? rgba[y * stride + i - 4] : 0;
      raw[row + 1 + i] = (rgba[y * stride + i] - left) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

function isLight([r, g, b]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

// Anti-aliased coverage (0..1) of the pixel centred at (px, py) by a rounded rectangle.
function roundedRect(px, py, [x0, y0, x1, y1, r]) {
  const qx = Math.abs(px - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(py - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  return Math.min(1, Math.max(0, 0.5 - distance));
}

// A folder icon in a 100x100 box: back panel with tab, a sheet of paper, front panel.
function folderShapes(rgb, box) {
  const ink = isLight(rgb) ? mix(rgb, BLACK, 0.45) : mix(rgb, WHITE, 0.75);
  const at = ([x0, y0, x1, y1, r]) => [
    box.x + (x0 * box.size) / 100,
    box.y + (y0 * box.size) / 100,
    box.x + (x1 * box.size) / 100,
    box.y + (y1 * box.size) / 100,
    (r * box.size) / 100
  ];
  return [
    { rect: at([6, 16, 44, 34, 6]), rgb: ink, alpha: 0.55 },
    { rect: at([6, 24, 94, 84, 8]), rgb: ink, alpha: 0.55 },
    { rect: at([16, 30, 84, 70, 3]), rgb: WHITE, alpha: 0.95 },
    { rect: at([6, 40, 94, 84, 8]), rgb: ink, alpha: 1 }
  ];
}

function draw(width, height, { background, shapes = [], mask }) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let color = background(px / width, py / height);
      for (const shape of shapes) {
        const a = shape.alpha * roundedRect(px, py, shape.rect);
        if (a > 0) color = mix(color, shape.rgb, a);
      }
      const i = (y * width + x) * 4;
      rgba[i] = Math.round(color[0]);
      rgba[i + 1] = Math.round(color[1]);
      rgba[i + 2] = Math.round(color[2]);
      rgba[i + 3] = mask ? Math.round(255 * roundedRect(px, py, mask)) : 255;
    }
  }
  return encodePng(width, height, rgba);
}

function poster(rgb) {
  return draw(300, 450, {
    background: (u, v) => mix(mix(rgb, WHITE, 0.12), mix(rgb, BLACK, 0.55), v * 0.8 + u * 0.2),
    shapes: folderShapes(rgb, { x: 50, y: 125, size: 200 })
  });
}

function background(rgb) {
  return draw(960, 540, {
    background: (u, v) => mix(mix(rgb, BLACK, 0.2), mix(rgb, BLACK, 0.85), Math.min(1, u * 0.7 + v * 0.5))
  });
}

function logo() {
  const rgb = hexToRgb('#7b5bf5');
  return draw(256, 256, {
    background: (u, v) => mix(mix(rgb, WHITE, 0.1), mix(rgb, BLACK, 0.35), (u + v) / 2),
    shapes: folderShapes(rgb, { x: 38, y: 38, size: 180 }),
    mask: [0, 0, 256, 256, 56]
  });
}

// Every image depends only on its color, so each one is drawn once and kept in memory.
const cache = new Map();

function image(kind, color) {
  const key = `${kind}:${color}`;
  if (!cache.has(key)) {
    if (kind === 'logo') cache.set(key, logo());
    else {
      if (color !== 'none' && !isColor(color)) return null;
      const rgb = hexToRgb(colorOf(color).hex);
      cache.set(key, kind === 'poster' ? poster(rgb) : background(rgb));
    }
  }
  return cache.get(key);
}

module.exports = { image, encodePng, crc32 };
