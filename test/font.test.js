'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadFont, measure } = require('../src/font');
const { createRaster } = require('../src/raster');

const font = loadFont(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'PlusJakartaSans-ExtraBold.ttf')));

test('reads the bundled font, accented letters included', () => {
  assert.equal(font.unitsPerEm, 1000);
  for (const char of 'Aaz09čšžĆđ…') assert.ok(font.glyph(char), `has ${char}`);
  assert.equal(font.glyph('🎬'), null);
  // "č" is built from "c" plus a caron, so it has the contours of both.
  assert.ok(font.outline(font.glyph('č')).length > font.outline(font.glyph('c')).length);
  assert.ok(measure(font, 'Western', 50) > measure(font, 'West', 50));
  assert.equal(measure(font, 'ab🎬', 50), measure(font, 'ab', 50));
});

test('rasterizes text with anti-aliased edges inside the canvas', () => {
  const width = 200;
  const height = 80;
  const raster = createRaster(width, height);
  raster.text(font, 'Hi', 10, 60, 56);
  const coverage = raster.coverage();
  const values = Array.from(coverage);
  assert.ok(values.every((v) => v >= 0 && v <= 1));
  assert.ok(values.some((v) => v === 1), 'solid strokes');
  assert.ok(values.some((v) => v > 0 && v < 1), 'smooth edges');
  // Nothing outside the text's horizontal extent, so no row bleeds into the next.
  const right = 10 + measure(font, 'Hi', 56) + 2;
  for (let y = 0; y < height; y++) {
    for (let x = Math.ceil(right); x < width; x++) assert.equal(coverage[y * width + x], 0);
  }
});
