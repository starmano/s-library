'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/shared');
const { keepStremioFields } = require('./fake-stremio-api');

const BASE = 'https://addon.test';
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

// Writes changes the way the Stremio API stores them and returns the resulting library.
function save(library, changes) {
  for (const item of changes) library.set(item._id, keepStremioFields(item));
  return library;
}

function load(library) {
  return S.fromLibraryItems([...library.values()]);
}

test('a folder survives the Stremio API, which keeps only standard library fields', () => {
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() }));
  assert.deepEqual(load(library), [{
    id: 'abc123',
    name: 'Favorites',
    description: 'All-time favorites',
    color: 'red',
    order: 2,
    items: [
      { id: 'tt0133093', type: 'movie', name: 'The Matrix', poster: 'https://example.com/matrix.jpg' },
      { id: 'kitsu:1', type: 'series', name: 'Cowboy Bebop' }
    ]
  }]);
});

test('only the folder itself is visible in the Stremio library', () => {
  const changes = S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map(), now: new Date('2026-01-01T00:00:00Z') });
  assert.deepEqual(changes.map((item) => [item._id, item.type, item.removed]), [
    ['slib:abc123', 'folder', false],
    ['slib:abc123:info', 'slibrary', true],
    ['slib:abc123:title:movie:tt0133093', 'slibrary', true],
    ['slib:abc123:title:series:kitsu:1', 'slibrary', true]
  ]);
  const [item] = changes;
  assert.equal(item.name, 'Favorites');
  assert.equal(item.poster, 'https://addon.test/img/poster/red.png?name=Favorites');
  assert.equal(item._mtime, '2026-01-01T00:00:00.000Z');
  assert.equal(item.state.noNotif, true);
  // Every item has the fields Stremio needs to read it.
  for (const change of changes) {
    for (const key of ['_id', 'name', 'type', 'posterShape', 'removed', 'temp', '_ctime', '_mtime', 'state', 'behaviorHints']) {
      assert.ok(key in change, `${change._id} has ${key}`);
    }
  }
});

test('edits write only what changed', () => {
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() }));
  assert.deepEqual(S.toLibraryItems(folder, { baseUrl: BASE, previous: library }), []);

  const renamed = S.toLibraryItems({ ...folder, name: 'Best' }, { baseUrl: BASE, previous: library });
  assert.deepEqual(renamed.map((item) => item._id), ['slib:abc123']);

  const recolored = S.toLibraryItems({ ...folder, color: 'blue' }, { baseUrl: BASE, previous: library });
  assert.deepEqual(recolored.map((item) => item._id), ['slib:abc123', 'slib:abc123:info']);
});

test('titles can be removed and added again, keeping the order they were added in', () => {
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map(), now: new Date('2026-01-01T00:00:00Z') }));
  const matrix = folder.items[0];
  const bebop = { id: 'kitsu:1', type: 'series', name: 'Cowboy Bebop' };

  const removal = S.toLibraryItems({ ...folder, items: [bebop] }, { baseUrl: BASE, previous: library });
  assert.deepEqual(removal.map((item) => [item._id, item.type]), [['slib:abc123:title:movie:tt0133093', 'slibrary-removed']]);
  save(library, removal);
  assert.deepEqual(load(library)[0].items.map((item) => item.name), ['Cowboy Bebop']);

  const readded = S.toLibraryItems({ ...folder, items: [bebop, matrix] }, { baseUrl: BASE, previous: library, now: new Date('2026-02-01T00:00:00Z') });
  save(library, readded);
  assert.deepEqual(load(library)[0].items.map((item) => item.name), ['Cowboy Bebop', 'The Matrix']);
});

test('deleting a folder hides it and its titles', () => {
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() }));
  const changes = S.deletionItems('abc123', { previous: library });
  assert.deepEqual(changes.map((item) => [item._id, item.removed, item.name]), [['slib:abc123', true, 'Favorites']]);
  assert.deepEqual(load(save(library, changes)), []);
});

test('poster links carry the color and the folder name', () => {
  assert.equal(S.posterUrl(BASE, 'green', ' Rock & Roll/2 '), 'https://addon.test/img/poster/green.png?name=Rock%20%26%20Roll%2F2');
  assert.equal(S.posterUrl(BASE, 'nope', ''), 'https://addon.test/img/poster/none.png');
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() }));
  const renamed = S.toLibraryItems({ ...folder, name: 'Best' }, { baseUrl: BASE, previous: library });
  assert.equal(renamed[0].poster, 'https://addon.test/img/poster/red.png?name=Best');
  // Moving to another address updates the poster too.
  const moved = S.toLibraryItems(folder, { baseUrl: 'https://s-library.example', previous: library });
  assert.deepEqual(moved.map((item) => item._id), ['slib:abc123']);
});

test('reads folders saved by the first version, and ignores everything else', () => {
  const folders = S.fromLibraryItems([
    { _id: 'slib:old', type: 'folder', name: 'Westerns', poster: 'https://addon.test/img/poster/brown.png', removed: false },
    { _id: 'slib:named', type: 'folder', name: 'Anime', poster: 'https://addon.test/img/poster/green.png?name=Anime', removed: false },
    { _id: 'slib:junk', type: 'folder', name: '', poster: 'https://addon.test/img/poster/constructor.png', removed: false },
    { _id: 'slib:junk:info', type: 'slibrary', name: '{not json', removed: true },
    { _id: 'slib:junk:bogus', type: 'slibrary', name: 'x', removed: true },
    { _id: 'slib:missing:title:movie:tt1', type: 'slibrary', name: 'Orphan', removed: true },
    { _id: 'tt0133093', type: 'movie', name: 'The Matrix', removed: false },
    null
  ]);
  assert.deepEqual(folders, [
    { id: 'named', name: 'Anime', description: '', color: 'green', order: 0, items: [] },
    { id: 'junk', name: 'Untitled folder', description: '', color: null, order: 0, items: [] },
    { id: 'old', name: 'Westerns', description: '', color: 'brown', order: 0, items: [] }
  ]);
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
