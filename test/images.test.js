'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { image, crc32 } = require('../src/images');

function chunks(png) {
  const out = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(png.readUInt32BE(offset + 8 + length), crc32(png.subarray(offset + 4, offset + 8 + length)), `${type} CRC`);
    out.push({ type, data });
    offset += 12 + length;
  }
  return out;
}

test('crc32 matches the reference value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

for (const [kind, color, width, height] of [
  ['poster', 'red', 300, 450],
  ['poster', 'none', 300, 450],
  ['bg', 'white', 960, 540],
  ['logo', undefined, 256, 256]
]) {
  test(`${kind} ${color || ''} is a valid ${width}x${height} PNG`, () => {
    const png = image(kind, color);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parts = chunks(png);
    assert.deepEqual(parts.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
    assert.equal(parts[0].data.readUInt32BE(0), width);
    assert.equal(parts[0].data.readUInt32BE(4), height);
    assert.equal(zlib.inflateSync(parts[1].data).length, (width * 4 + 1) * height);
    assert.equal(image(kind, color), png, 'cached');
  });
}

test('unknown colors are rejected', () => {
  assert.equal(image('poster', 'chartreuse'), null);
  assert.equal(image('bg', 'constructor'), null);
});
