// Anti-aliased coverage masks for text and icons, which images.js paints onto posters.
// Shapes are built from straight edges (curves are split into short lines) and filled with
// signed-area accumulation: exact anti-aliasing, and overlapping shapes don't double up.
'use strict';

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

  // Edges are kept inside the canvas: anything past the left or right edge would spill into
  // the neighbouring row.
  const clampX = (value) => Math.min(width - 1, Math.max(0, value));
  function edge(x0, y0, x1, y1) {
    line(clampX(x0), y0, clampX(x1), y1);
  }

  function quad(x0, y0, cx, cy, x1, y1) {
    let [px, py] = [x0, y0];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const u = 1 - t;
      const nx = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const ny = u * u * y0 + 2 * u * t * cy + t * t * y1;
      edge(px, py, nx, ny);
      [px, py] = [nx, ny];
    }
  }

  function cubic(x0, y0, c1x, c1y, c2x, c2y, x1, y1) {
    let [px, py] = [x0, y0];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      const u = 1 - t;
      const nx = u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1;
      const ny = u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1;
      edge(px, py, nx, ny);
      [px, py] = [nx, ny];
    }
  }

  // An elliptical arc as in SVG paths (endpoints, radii, rotation, flags), following the
  // conversion to centre form in the SVG specification.
  function arc(x1, y1, rx, ry, rotation, largeArc, sweep, x2, y2) {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry || (x1 === x2 && y1 === y2)) return edge(x1, y1, x2, y2);
    const phi = (rotation * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const hx = (x1 - x2) / 2;
    const hy = (y1 - y2) / 2;
    const x1p = cos * hx + sin * hy;
    const y1p = -sin * hx + cos * hy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const start = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    else if (sweep && delta < 0) delta += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
    let [px, py] = [x1, y1];
    for (let i = 1; i <= steps; i++) {
      const t = start + (delta * i) / steps;
      const nx = i === steps ? x2 : cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin;
      const ny = i === steps ? y2 : cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos;
      edge(px, py, nx, ny);
      [px, py] = [nx, ny];
    }
  }

  // Fills SVG path data (the "d" of a <path>), scaled by `scale` and moved to (x, y).
  // Supports all path commands; arc flags must be separated like other numbers.
  function path(d, x, y, scale) {
    const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    const at = (px, py) => [x + px * scale, y + py * scale];
    let i = 0;
    let command = '';
    let [cx, cy] = [0, 0]; // current point, in path units
    let [sx, sy] = [0, 0]; // start of the current subpath
    let control = null; // last curve control point, for the S and T shorthands
    let previous = '';
    const lineTo = (nx, ny) => {
      edge(...at(cx, cy), ...at(nx, ny));
      [cx, cy] = [nx, ny];
    };
    const closeSubpath = () => {
      if (cx !== sx || cy !== sy) lineTo(sx, sy);
    };
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
      const relative = command === command.toLowerCase();
      const n = () => parseFloat(tokens[i++]);
      const px = () => (relative ? cx : 0) + n();
      const py = () => (relative ? cy : 0) + n();
      const upper = command.toUpperCase();
      if (upper === 'M') {
        closeSubpath();
        [cx, cy] = [px(), py()];
        [sx, sy] = [cx, cy];
        command = relative ? 'l' : 'L'; // further pairs are lines
      } else if (upper === 'L') {
        const nx = px();
        lineTo(nx, py());
      } else if (upper === 'H') {
        lineTo(px(), cy);
      } else if (upper === 'V') {
        lineTo(cx, py());
      } else if (upper === 'C' || upper === 'S') {
        let c1;
        if (upper === 'C') c1 = [px(), py()];
        else c1 = /[CS]/.test(previous) && control ? [2 * cx - control[0], 2 * cy - control[1]] : [cx, cy];
        const c2 = [px(), py()];
        const end = [px(), py()];
        cubic(...at(cx, cy), ...at(...c1), ...at(...c2), ...at(...end));
        control = c2;
        [cx, cy] = end;
      } else if (upper === 'Q' || upper === 'T') {
        let c1;
        if (upper === 'Q') c1 = [px(), py()];
        else c1 = /[QT]/.test(previous) && control ? [2 * cx - control[0], 2 * cy - control[1]] : [cx, cy];
        const end = [px(), py()];
        quad(...at(cx, cy), ...at(...c1), ...at(...end));
        control = c1;
        [cx, cy] = end;
      } else if (upper === 'A') {
        const [rx, ry, rotation, largeArc, sweep] = [n(), n(), n(), n(), n()];
        const end = [px(), py()];
        arc(...at(cx, cy), rx * scale, ry * scale, rotation, largeArc, sweep, ...at(...end));
        [cx, cy] = end;
      } else if (upper === 'Z') {
        closeSubpath();
      } else {
        i++; // not a path command: skip it
      }
      previous = upper;
    }
    closeSubpath();
  }

  // Draws `string` with its baseline starting at (x, baseline).
  function text(font, string, x, baseline, size) {
    const scale = size / font.unitsPerEm;
    for (const char of string) {
      const gid = font.glyph(char);
      if (!gid) continue;
      for (const contour of font.outline(gid)) {
        if (contour.length < 2) continue;
        const pts = contour.map((pt) => ({ x: x + pt.x * scale, y: baseline - pt.y * scale, on: pt.on }));
        const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
        // Walk the contour from an on-curve point (or, if there is none, from the implied point
        // between the last and first ones) back to itself. Two off-curve points in a row have an
        // implied on-curve point halfway between them.
        const firstOn = pts.findIndex((pt) => pt.on);
        const start = firstOn >= 0 ? pts[firstOn] : mid(pts[pts.length - 1], pts[0]);
        const outline = firstOn >= 0 ? pts.slice(firstOn + 1).concat(pts.slice(0, firstOn)) : pts;
        let current = start;
        let control = null;
        for (const pt of outline.concat(start)) {
          if (!pt.on) {
            if (control) {
              const implied = mid(control, pt);
              quad(current.x, current.y, control.x, control.y, implied.x, implied.y);
              current = implied;
            }
            control = pt;
          } else {
            if (control) quad(current.x, current.y, control.x, control.y, pt.x, pt.y);
            else edge(current.x, current.y, pt.x, pt.y);
            current = pt;
            control = null;
          }
        }
      }
      x += font.advance(gid) * scale;
    }
  }

  // Each row's contributions add up to zero, so summing per row keeps rounding errors from
  // building up; leftovers too small to see are dropped.
  function coverage() {
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

  return { text, path, coverage };
}

module.exports = { createRaster };
