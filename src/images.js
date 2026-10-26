// Folder artwork (posters, backgrounds, logo) drawn as PNGs with nothing but node:zlib.
// PNG rather than SVG because not every Stremio app can display SVG posters.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { isColor, colorOf, LIMITS, DEFAULT_ICON, NO_ICON } = require('./shared');
const { loadFont, measure } = require('./font');
const { createRaster } = require('./raster');

const font = loadFont(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'PlusJakartaSans-ExtraBold.ttf')));
// Folder icons (Phosphor, 256-unit SVG paths), keyed by the names stored with each folder.
const ICONS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'icons', 'icons.json'), 'utf8'));

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
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
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
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const distance = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  return Math.min(1, Math.max(0, 0.5 - distance));
}

// The color artwork is drawn in: a darker or lighter shade of the background.
function inkOf(rgb) {
  return isLight(rgb) ? mix(rgb, BLACK, 0.45) : mix(rgb, WHITE, 0.75);
}

// A folder icon in a 100x100 box: back panel with tab, a sheet of paper, front panel.
function folderShapes(rgb, box) {
  const ink = inkOf(rgb);
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

// `layers` are coverage masks (e.g. text) painted over the shapes, optionally shifted down.
function draw(width, height, { background, shapes = [], layers = [], mask }) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let [r, g, b] = background(px / width, py / height);
      const paint = (rgb, a) => {
        r += (rgb[0] - r) * a;
        g += (rgb[1] - g) * a;
        b += (rgb[2] - b) * a;
      };
      for (const shape of shapes) {
        const a = shape.alpha * roundedRect(px, py, shape.rect);
        if (a > 0) paint(shape.rgb, a);
      }
      for (const layer of layers) {
        const sy = y - (layer.shift || 0);
        const a = sy >= 0 ? layer.alpha * layer.coverage[sy * width + x] : 0;
        if (a > 0) paint(layer.rgb, a);
      }
      const i = (y * width + x) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = mask ? Math.round(255 * roundedRect(px, py, mask)) : 255;
    }
  }
  return encodePng(width, height, rgba);
}

// Lays a folder name out in at most `maxLines` lines of `maxWidth`, as large as it fits.
// Long names end in "…" at the smallest size.
function layoutTitle(name, maxWidth, maxLines) {
  const sizes = [56, 52, 48, 44, 40, 36, 32, 28];
  const words = name.split(' ');
  const wrap = (size, breakWords) => {
    const lines = [];
    let line = '';
    for (const word of words) {
      const joined = line ? `${line} ${word}` : word;
      if (measure(font, joined, size) <= maxWidth) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      if (measure(font, word, size) > maxWidth) {
        if (!breakWords) return null;
        for (const char of word) {
          if (line && measure(font, line + char, size) > maxWidth) {
            lines.push(line);
            line = '';
          }
          line += char;
        }
      } else line = word;
    }
    if (line) lines.push(line);
    return lines;
  };
  for (const size of sizes) {
    const lines = wrap(size, false);
    if (lines && lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  const lines = wrap(size, true);
  if (lines.length > maxLines) {
    let last = Array.from(lines[maxLines - 1]);
    while (last.length && measure(font, `${last.join('').trimEnd()}…`, size) > maxWidth) last.pop();
    lines.splice(maxLines - 1, Infinity, `${last.join('').trimEnd()}…`);
  }
  return { size, lines };
}

function poster(rgb, name, icon) {
  const width = 300;
  const height = 450;
  const backdrop = (u, v) => mix(mix(rgb, WHITE, 0.12), mix(rgb, BLACK, 0.55), v * 0.8 + u * 0.2);
  // Keep only characters the font can draw.
  const title = Array.from(name || '').filter((char) => char === ' ' || font.glyph(char)).join('').replace(/\s+/g, ' ').trim();

  // The artwork (folder or icon) above the name, the pair centred on the poster.
  const art = icon !== NO_ICON;
  const artHeight = art ? (title ? 92 : 140) : 0;
  const layout = title ? layoutTitle(title, 256, art ? 3 : 5) : null;
  const capHeight = layout ? (font.capHeight * layout.size) / font.unitsPerEm : 0;
  const lineHeight = layout ? layout.size * 1.15 : 0;
  const gap = layout && art ? 30 : 0;
  const top = (height - (artHeight + gap + (layout ? capHeight + (layout.lines.length - 1) * lineHeight : 0))) / 2;

  let shapes = [];
  const layers = [];
  if (!art) {
    // Just the name.
  } else if (icon !== DEFAULT_ICON && ICONS[icon]) {
    // Icons fill 224 of their 256 units.
    const box = artHeight / 0.875;
    const raster = createRaster(width, height);
    raster.path(ICONS[icon].path, (width - box) / 2, top - box * 0.0625, box / 256);
    layers.push({ coverage: raster.coverage(), rgb: inkOf(rgb), alpha: 1 });
  } else {
    // The folder fills 68% of its box's height.
    const box = artHeight / 0.68;
    shapes = folderShapes(rgb, { x: (width - box) / 2, y: top - box * 0.16, size: box });
  }
  if (layout) {
    const raster = createRaster(width, height);
    layout.lines.forEach((line, i) => {
      const x = (width - measure(font, line, layout.size)) / 2;
      raster.text(font, line, x, top + artHeight + gap + capHeight + i * lineHeight, layout.size);
    });
    const coverage = raster.coverage();
    const light = isLight(rgb);
    layers.push(
      { coverage, rgb: BLACK, alpha: light ? 0 : 0.25, shift: 2 },
      { coverage, rgb: light ? mix(rgb, BLACK, 0.8) : WHITE, alpha: 1 }
    );
  }
  return draw(width, height, { background: backdrop, shapes, layers });
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

// Images depend only on their color (and a poster on its folder name), so recently drawn
// ones are kept in memory.
const cache = new Map();
const CACHE_MAX = 300;

function image(kind, color, name = '', icon = DEFAULT_ICON) {
  if (kind !== 'logo' && color !== 'none' && !isColor(color)) return null;
  const title = kind === 'poster' ? String(name).slice(0, LIMITS.name) : '';
  const art = kind === 'poster' && (icon === NO_ICON || Object.prototype.hasOwnProperty.call(ICONS, icon)) ? icon : DEFAULT_ICON;
  const key = `${kind}:${color}:${art}:${title}`;
  let png = cache.get(key);
  if (png) cache.delete(key);
  else if (kind === 'logo') png = logo();
  else if (kind === 'poster') png = poster(hexToRgb(colorOf(color).hex), title, art);
  else png = background(hexToRgb(colorOf(color).hex));
  cache.set(key, png);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return png;
}

module.exports = { image, encodePng, crc32, ICONS };
