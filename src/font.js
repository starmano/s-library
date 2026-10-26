// A small TrueType reader and anti-aliased text rasterizer, enough to write folder names on posters.
// Handles what the bundled font uses: format 4 character maps and simple and composite glyphs.
'use strict';

function loadFont(buf) {
  const tables = {};
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const record = 12 + i * 16;
    tables[buf.toString('latin1', record, record + 4)] = buf.readUInt32BE(record + 8);
  }
  const unitsPerEm = buf.readUInt16BE(tables.head + 18);
  const longOffsets = buf.readInt16BE(tables.head + 50) === 1;
  const numGlyphs = buf.readUInt16BE(tables.maxp + 4);
  const numHMetrics = buf.readUInt16BE(tables.hhea + 34);
  const capHeight = buf.readUInt16BE(tables['OS/2']) >= 2 ? buf.readInt16BE(tables['OS/2'] + 88) : unitsPerEm * 0.7;

  const glyphOffset = (gid) => longOffsets
    ? buf.readUInt32BE(tables.loca + gid * 4)
    : buf.readUInt16BE(tables.loca + gid * 2) * 2;

  // Character code -> glyph id, from the Windows Unicode (3, 1) format 4 subtable.
  const cmap = new Map();
  for (let i = 0; i < buf.readUInt16BE(tables.cmap + 2); i++) {
    const record = tables.cmap + 4 + i * 8;
    if (buf.readUInt16BE(record) !== 3 || buf.readUInt16BE(record + 2) !== 1) continue;
    const sub = tables.cmap + buf.readUInt32BE(record + 4);
    if (buf.readUInt16BE(sub) !== 4) continue;
    const segments = buf.readUInt16BE(sub + 6) / 2;
    const ends = sub + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const end = buf.readUInt16BE(ends + s * 2);
      const delta = buf.readUInt16BE(deltas + s * 2);
      const rangeOffset = buf.readUInt16BE(rangeOffsets + s * 2);
      for (let code = buf.readUInt16BE(starts + s * 2); code <= end && code !== 0xffff; code++) {
        let gid = (code + delta) & 0xffff;
        if (rangeOffset) {
          gid = buf.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (code - buf.readUInt16BE(starts + s * 2)) * 2);
          if (gid) gid = (gid + delta) & 0xffff;
        }
        if (gid) cmap.set(code, gid);
      }
    }
  }

  function advance(gid) {
    return buf.readUInt16BE(tables.hmtx + Math.min(gid, numHMetrics - 1) * 4);
  }

  // Contours of { x, y, on } points in font units.
  function outline(gid) {
    if (gid >= numGlyphs) return [];
    const start = tables.glyf + glyphOffset(gid);
    if (glyphOffset(gid + 1) === glyphOffset(gid)) return [];
    const contourCount = buf.readInt16BE(start);
    return contourCount >= 0 ? simpleGlyph(start, contourCount) : compositeGlyph(start);
  }

  function simpleGlyph(start, contourCount) {
    const ends = [];
    for (let i = 0; i < contourCount; i++) ends.push(buf.readUInt16BE(start + 10 + i * 2));
    const pointCount = contourCount ? ends[contourCount - 1] + 1 : 0;
    let p = start + 10 + contourCount * 2;
    p += 2 + buf.readUInt16BE(p); // skip instructions
    const flags = [];
    while (flags.length < pointCount) {
      const flag = buf[p++];
      flags.push(flag);
      if (flag & 8) for (let repeat = buf[p++]; repeat > 0; repeat--) flags.push(flag);
    }
    const readCoords = (shortBit, sameBit) => {
      const values = [];
      let value = 0;
      for (const flag of flags) {
        if (flag & shortBit) value += flag & sameBit ? buf[p++] : -buf[p++];
        else if (!(flag & sameBit)) { value += buf.readInt16BE(p); p += 2; }
        values.push(value);
      }
      return values;
    };
    const xs = readCoords(2, 16);
    const ys = readCoords(4, 32);
    const contours = [];
    let first = 0;
    for (const end of ends) {
      const contour = [];
      for (let i = first; i <= end; i++) contour.push({ x: xs[i], y: ys[i], on: Boolean(flags[i] & 1) });
      contours.push(contour);
      first = end + 1;
    }
    return contours;
  }

  function compositeGlyph(start) {
    const contours = [];
    let p = start + 10;
    for (let more = true; more; ) {
      const flags = buf.readUInt16BE(p);
      const component = buf.readUInt16BE(p + 2);
      p += 4;
      let dx;
      let dy;
      if (flags & 1) { dx = buf.readInt16BE(p); dy = buf.readInt16BE(p + 2); p += 4; }
      else { dx = buf.readInt8(p); dy = buf.readInt8(p + 1); p += 2; }
      if (!(flags & 2)) dx = dy = 0; // point-matched placement isn't used by this font
      let [a, b, c, d] = [1, 0, 0, 1];
      const f2dot14 = (offset) => buf.readInt16BE(offset) / 16384;
      if (flags & 8) { a = d = f2dot14(p); p += 2; }
      else if (flags & 0x40) { a = f2dot14(p); d = f2dot14(p + 2); p += 4; }
      else if (flags & 0x80) { a = f2dot14(p); b = f2dot14(p + 2); c = f2dot14(p + 4); d = f2dot14(p + 6); p += 8; }
      for (const contour of outline(component)) {
        contours.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
      }
      more = Boolean(flags & 0x20);
    }
    return contours;
  }

  return {
    unitsPerEm,
    capHeight,
    glyph: (char) => cmap.get(char.codePointAt(0)) || null,
    advance,
    outline
  };
}

// Text width in pixels at `size`, skipping characters the font doesn't have.
function measure(font, text, size) {
  let width = 0;
  for (const char of text) {
    const gid = font.glyph(char);
    if (gid) width += font.advance(gid);
  }
  return (width * size) / font.unitsPerEm;
}

// Coverage mask built from straight edges (quadratic curves are split into short lines),
// using signed-area accumulation: exact anti-aliasing, and overlapping shapes don't double up.
function createRaster(width, height) {
  const acc = new Float32Array(width * height + 4);

  function line(x0, y0, x1, y1) {
    if (y0 === y1) return;
    let dir = 1;
    if (y0 > y1) {
      [x0, y0, x1, y1] = [x1, y1, x0, y0];
      dir = -1;
    }
    const dxdy = (x1 - x0) / (y1 - y0);
    let x = x0;
    if (y0 < 0) x -= y0 * dxdy;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) {
      const row = y * width;
      const dy = Math.min(y + 1, y1) - Math.max(y, y0);
      const xnext = x + dxdy * dy;
      const d = dy * dir;
      const xa = Math.min(x, xnext);
      const xb = Math.max(x, xnext);
      const xaFloor = Math.floor(xa);
      const xbCeil = Math.ceil(xb);
      const i = row + xaFloor;
      if (xbCeil <= xaFloor + 1) {
        const mid = 0.5 * (x + xnext) - xaFloor;
        acc[i] += d - d * mid;
        acc[i + 1] += d * mid;
      } else {
        const s = 1 / (xb - xa);
        const xaFrac = xa - xaFloor;
        const a0 = 0.5 * s * (1 - xaFrac) * (1 - xaFrac);
        const xbFrac = xb - xbCeil + 1;
        const am = 0.5 * s * xbFrac * xbFrac;
        acc[i] += d * a0;
        if (xbCeil === xaFloor + 2) {
          acc[i + 1] += d * (1 - a0 - am);
        } else {
          const a1 = s * (1.5 - xaFrac);
          acc[i + 1] += d * (a1 - a0);
          for (let xi = xaFloor + 2; xi < xbCeil - 1; xi++) acc[row + xi] += d * s;
          const a2 = a1 + (xbCeil - xaFloor - 3) * s;
          acc[row + xbCeil - 1] += d * (1 - a2 - am);
        }
        acc[row + xbCeil] += d * am;
      }
      x = xnext;
    }
  }

  function quad(x0, y0, cx, cy, x1, y1) {
    const steps = 8;
    let px = x0;
    let py = y0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const nx = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const ny = u * u * y0 + 2 * u * t * cy + t * t * y1;
      line(px, py, nx, ny);
      px = nx;
      py = ny;
    }
  }

  // Draws `text` with its baseline starting at (x, baseline); x must keep the text inside the canvas.
  function text(font, string, x, baseline, size) {
    const scale = size / font.unitsPerEm;
    for (const char of string) {
      const gid = font.glyph(char);
      if (!gid) continue;
      for (const contour of font.outline(gid)) {
        if (contour.length < 2) continue;
        // Points are kept inside the canvas: anything past an edge would spill into the next row.
        const clampX = (value) => Math.min(width - 1, Math.max(0, value));
        const pts = contour.map((pt) => ({ x: clampX(x + pt.x * scale), y: baseline - pt.y * scale, on: pt.on }));
        const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
        // Walk the contour from an on-curve point (or, if there is none, from the implied point
        // between the last and first ones) back to itself. Two off-curve points in a row have an
        // implied on-curve point halfway between them.
        const firstOn = pts.findIndex((pt) => pt.on);
        const start = firstOn >= 0 ? pts[firstOn] : mid(pts[pts.length - 1], pts[0]);
        const path = firstOn >= 0 ? pts.slice(firstOn + 1).concat(pts.slice(0, firstOn)) : pts;
        let current = start;
        let control = null;
        for (const pt of path.concat(start)) {
          if (!pt.on) {
            if (control) {
              const implied = mid(control, pt);
              quad(current.x, current.y, control.x, control.y, implied.x, implied.y);
              current = implied;
            }
            control = pt;
          } else {
            if (control) quad(current.x, current.y, control.x, control.y, pt.x, pt.y);
            else line(current.x, current.y, pt.x, pt.y);
            current = pt;
            control = null;
          }
        }
      }
      x += font.advance(gid) * scale;
    }
  }

  function coverage() {
    // Each row's contributions add up to zero, so summing per row keeps rounding errors from
    // building up; leftovers too small to see are dropped.
    const out = new Float32Array(width * height);
    for (let row = 0; row < out.length; row += width) {
      let sum = 0;
      for (let i = row; i < row + width; i++) {
        sum += acc[i];
        const value = Math.abs(sum);
        out[i] = value < 1 / 1024 ? 0 : Math.min(1, value);
      }
    }
    return out;
  }

  return { text, coverage };
}

module.exports = { loadFont, measure, createRaster };
