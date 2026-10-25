'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/shared');

const folder = {
  id: 'abc123',
  name: '  Favorites ',
  description: 'All-time favorites',
  color: 'red',
  order: 2,
  items: [
    { id: 'tt0133093', type: 'movie', name: 'The Matrix', poster: 'https://example.com/matrix.jpg' },
    { id: 'tt0133093', type: 'movie', name: 'Duplicate' },
    { id: 'kitsu:1', type: 'series', name: 'Cowboy Bebop', poster: 'javascript:alert(1)' },
    { type: 'movie', name: 'No id' }
  ]
};

test('a folder round-trips through a Stremio library item', () => {
  const item = S.toLibraryItem(folder, { baseUrl: 'https://addon.test', now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(item._id, 'slib:abc123');
  assert.equal(item.type, 'folder');
  assert.equal(item.name, 'Favorites');
  assert.equal(item.poster, 'https://addon.test/img/poster/red.png');
  assert.equal(item.removed, false);
  assert.equal(item._mtime, '2026-01-01T00:00:00.000Z');
  assert.equal(item.state.noNotif, true);
  assert.equal(item.behaviorHints.defaultVideoId, null);

  assert.deepEqual(S.fromLibraryItem(item), {
    id: 'abc123',
    name: 'Favorites',
    description: 'All-time favorites',
    color: 'red',
    order: 2,
    items: [
      { id: 'tt0133093', type: 'movie', name: 'The Matrix', poster: 'https://example.com/matrix.jpg' },
      { id: 'kitsu:1', type: 'series', name: 'Cowboy Bebop' }
    ],
    removed: false
  });
});

test('editing keeps creation time, watch state and unknown fields', () => {
  const previous = S.toLibraryItem(folder, { baseUrl: 'https://addon.test', now: new Date('2026-01-01T00:00:00Z') });
  previous.state.timesWatched = 3;
  previous.behaviorHints.somethingNew = true;
  const edited = S.toLibraryItem({ ...folder, name: 'Best', color: null }, {
    baseUrl: 'https://addon.test',
    previous,
    now: new Date('2026-02-01T00:00:00Z')
  });
  assert.equal(edited._ctime, '2026-01-01T00:00:00.000Z');
  assert.equal(edited._mtime, '2026-02-01T00:00:00.000Z');
  assert.equal(edited.state.timesWatched, 3);
  assert.equal(edited.behaviorHints.somethingNew, true);
  assert.equal(edited.poster, 'https://addon.test/img/poster/none.png');
  assert.equal(S.fromLibraryItem(edited).name, 'Best');
});

test('ignores library items that are not folders and cleans bad data', () => {
  assert.equal(S.fromLibraryItem({ _id: 'tt0133093', type: 'movie', name: 'The Matrix' }), null);
  assert.equal(S.fromLibraryItem({ _id: 'slib:x', type: 'movie' }), null);
  const parsed = S.fromLibraryItem({
    _id: 'slib:x',
    type: 'folder',
    name: '',
    behaviorHints: { slibrary: { color: 'constructor', description: 42, items: 'nope', order: 'first' } }
  });
  assert.deepEqual(parsed, { id: 'x', name: 'Untitled folder', description: '', color: null, order: 0, items: [], removed: false });
});

test('sorts folders by order, then name', () => {
  const sorted = S.sortFolders([
    { name: 'b', order: 1 },
    { name: 'c', order: 0 },
    { name: 'a', order: 1 }
  ]);
  assert.deepEqual(sorted.map((f) => f.name), ['c', 'a', 'b']);
});

test('addon config is URL-safe and survives a round trip', () => {
  const key = 'a+b/c=d?e&f' + 'x'.repeat(40);
  const segment = S.encodeConfig({ k: key });
  assert.match(segment, /^[\w-]+$/);
  assert.deepEqual(S.decodeConfig(segment), { k: key });
  assert.equal(S.decodeConfig('not-json'), null);
  assert.equal(S.decodeConfig(S.encodeConfig({ k: '' })), null);
});

test('every color has a label, hex value and emoji', () => {
  for (const color of Object.values(S.COLORS)) {
    assert.ok(color.label);
    assert.match(color.hex, /^#[0-9a-f]{6}$/);
    assert.ok(color.emoji);
  }
  assert.equal(S.colorOf('nope'), S.NO_COLOR);
});
