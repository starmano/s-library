// A small TrueType reader, enough to write folder names on posters (drawn by raster.js).
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

module.exports = { loadFont, measure };
