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
    icon: 'folder',
    showName: true,
    version: 0,
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

test('a folder can have an icon, shown on its poster', () => {
  const library = save(new Map(), S.toLibraryItems({ ...folder, icon: 'western' }, { baseUrl: BASE, previous: new Map() }));
  const [loaded] = load(library);
  assert.equal(loaded.icon, 'western');
  assert.equal(library.get('slib:abc123').poster, 'https://addon.test/img/poster/red.png?name=Favorites&icon=western');
  // The default icon isn't stored, so folders saved before icons existed don't change.
  const plain = S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() });
  assert.doesNotMatch(plain[1].name, /"i"/);
  assert.equal(S.posterUrl(BASE, 'red', '', 'spy'), 'https://addon.test/img/poster/red.png?icon=spy');
  assert.equal(S.cleanIcon('<script>'), 'folder');
});

test('folders can be hidden from the Library and shown again', () => {
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() }));
  // A folder deleted with Stremio's own "Remove from library" button, before folders could be hidden.
  save(library, S.toLibraryItems({ id: 'gone', name: 'Gone', items: [] }, { baseUrl: BASE, previous: library }));
  library.get('slib:gone').removed = true;
  assert.deepEqual(load(library).map((f) => f.id), ['abc123']);
  assert.equal(S.readSettings(library.values()).library, true);

  save(library, S.settingsItems({ library: false }, { previous: library }));
  assert.equal(S.readSettings(library.values()).library, false);
  assert.equal(library.get('slib:abc123').removed, true, 'hidden from the Library');
  assert.equal(library.get('slib:gone').type, 'slibrary-removed', 'still deleted');
  assert.deepEqual(load(library).map((f) => f.id), ['abc123'], 'hidden folders still exist');

  // New folders follow the setting.
  save(library, S.toLibraryItems({ id: 'new1', name: 'New', items: [] }, { baseUrl: BASE, previous: library }));
  assert.equal(library.get('slib:new1').removed, true);
  assert.deepEqual(S.settingsItems({ library: false }, { previous: library }), [], 'nothing to change');

  save(library, S.settingsItems({ library: true }, { previous: library }));
  assert.equal(library.get('slib:abc123').removed, false);
  assert.equal(library.get('slib:new1').removed, false);
  assert.deepEqual(load(library).map((f) => f.id).sort(), ['abc123', 'new1']);
});

test("Stremio's own \"Remove from library\" takes a folder out of the Library without deleting it", () => {
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() }));
  // Before: removing a folder from the Library with Stremio's button deleted it.
  save(library, S.toLibraryItems({ id: 'gone', name: 'Gone', items: [] }, { baseUrl: BASE, previous: library }));
  library.get('slib:gone').removed = true;
  assert.deepEqual(load(library).map((f) => f.id), ['abc123']);

  // The migration keeps those deleted, once.
  const migration = S.migrationItems(library);
  assert.deepEqual(migration.map((item) => [item._id, item.type]), [['slib:gone', 'slibrary-removed'], ['slib::settings', 'slibrary']]);
  save(library, migration);
  assert.deepEqual(S.migrationItems(library), [], 'only once');
  assert.deepEqual(load(library).map((f) => f.id), ['abc123']);

  // After: the folder only leaves the Library, and stays out of it when it's edited.
  library.get('slib:abc123').removed = true;
  assert.deepEqual(load(library).map((f) => f.id), ['abc123']);
  save(library, S.toLibraryItems({ ...load(library)[0], name: 'Renamed' }, { baseUrl: BASE, previous: library }));
  assert.equal(library.get('slib:abc123').removed, true);
  // Stremio's "Add to library" brings it back.
  library.get('slib:abc123').removed = false;
  assert.equal(load(library)[0].name, 'Renamed');
  // The Library switch still shows or hides every folder.
  library.get('slib:abc123').removed = true;
  save(library, S.settingsItems({ library: false }, { previous: library }));
  save(library, S.settingsItems({ library: true }, { previous: library }));
  assert.equal(library.get('slib:abc123').removed, false);
});

test('a deleted folder stays deleted whether folders are shown or hidden', () => {
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() }));
  save(library, S.settingsItems({ library: false }, { previous: library }));
  save(library, S.deletionItems('abc123', { previous: library }));
  assert.deepEqual(load(library), []);
  save(library, S.settingsItems({ library: true }, { previous: library }));
  assert.deepEqual(load(library), []);
});

test('a folder can leave its name off the poster, or have no icon', () => {
  const changes = S.toLibraryItems({ ...folder, showName: false, icon: 'none' }, { baseUrl: BASE, previous: new Map() });
  assert.equal(changes[0].name, 'Favorites', 'the name is still the name');
  assert.equal(changes[0].poster, 'https://addon.test/img/poster/red.png?icon=none');
  const [loaded] = load(save(new Map(), changes));
  assert.equal(loaded.showName, false);
  assert.equal(loaded.icon, 'none');
  assert.equal(S.folderPoster(BASE, loaded), changes[0].poster);
  assert.equal(S.folderPoster(BASE, { ...loaded, showName: true, icon: 'folder' }), 'https://addon.test/img/poster/red.png?name=Favorites');
});

test('folders can be left out of Discover and search', () => {
  const library = save(new Map(), S.toLibraryItems(folder, { baseUrl: BASE, previous: new Map() }));
  assert.deepEqual(S.readSettings(library.values()), { library: true, discover: true, search: true, version: 0, keep: false, stored: false });
  const now = new Date('2026-02-01T00:00:00Z');
  const changes = S.settingsItems({ discover: false }, { previous: library, now });
  assert.deepEqual(changes.map((item) => item._id), ['slib::settings'], 'the folders themselves are not touched');
  save(library, changes);
  save(library, S.settingsItems({ search: false }, { previous: library }));
  const settings = S.readSettings(library.values());
  assert.deepEqual([settings.library, settings.discover, settings.search], [true, false, false]);
  assert.ok(settings.version > now.getTime());
  assert.deepEqual(S.settingsItems({ discover: false, search: false }, { previous: library }), []);
  assert.deepEqual(load(library).map((f) => f.id), ['abc123']);
});

test("a folder's version is stored with it", () => {
  const library = save(new Map(), S.toLibraryItems({ ...folder, version: 1234 }, { baseUrl: BASE, previous: new Map() }));
  assert.equal(load(library)[0].version, 1234);
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
    { id: 'named', name: 'Anime', description: '', color: 'green', order: 0, icon: 'folder', showName: true, version: 0, items: [] },
    { id: 'junk', name: 'Untitled folder', description: '', color: null, order: 0, icon: 'folder', showName: true, version: 0, items: [] },
    { id: 'old', name: 'Westerns', description: '', color: 'brown', order: 0, icon: 'folder', showName: true, version: 0, items: [] }
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
  const emoji = Object.values(S.COLORS).map((color) => color.emoji).concat(S.NO_COLOR.emoji);
  assert.equal(new Set(emoji).size, emoji.length, 'every color is marked differently in row names');
  assert.equal(S.colorOf('nope'), S.NO_COLOR);
});
