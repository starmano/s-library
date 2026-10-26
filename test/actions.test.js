'use strict';

// Editing folders inside Stremio: search cards, folder-page links and stream-list entries all lead
// to "slib:do:..." pages, which the addon serves as meta. These tests open them the way Stremio does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeApi } = require('./fake-stremio-api');
const S = require('../src/shared');

const none = new Map();
const items = [
  ...S.toLibraryItems(
    { id: 'fav', name: 'Favorites', description: 'The best ones', color: 'blue', order: 0, items: [{ id: 'tt0133093', type: 'movie', name: 'The Matrix' }] },
    { baseUrl: 'https://old.host', previous: none, now: new Date('2026-01-01T00:00:00Z') }
  ),
  ...S.toLibraryItems({ id: 'later', name: 'Watch later', order: 1, items: [] }, { baseUrl: 'https://old.host', previous: none }),
  { _id: 'tt0111161', name: 'The Shawshank Redemption', type: 'movie', removed: false, temp: false, _mtime: '2026-01-01T00:00:00Z' }
];

let api;
let base;
let server;
let config;

test.before(async () => {
  api = await startFakeApi({ items });
  process.env.STREMIO_API_URL = api.url;
  process.env.CINEMETA_URL = api.url;
  const { createServer } = require('../src/server');
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  config = S.encodeConfig({ k: 'test-auth-key' });
  api.collection.addons = [
    { transportUrl: `${base}/${config}/manifest.json`, manifest: { id: 'community.slibrary', catalogs: [] } },
    { transportUrl: 'https://other.addon/manifest.json', manifest: { id: 'other' } }
  ];
});

test.after(() => {
  server.close();
  api.close();
});

async function json(path) {
  return (await fetch(base + path)).json();
}

function search(query) {
  return json(`/${config}/catalog/folder/slib.search/search=${encodeURIComponent(query)}.json`).then((body) => body.metas);
}

// Opens a page the way the Stremio apps do: by asking for its meta.
async function open(idOrLink) {
  const id = idOrLink.startsWith('stremio:///detail/folder/') ? decodeURIComponent(idOrLink.split('/').pop()) : idOrLink;
  const { meta } = await json(`/${config}/meta/folder/${encodeURIComponent(id)}.json`);
  return meta;
}

function linkTo(meta, category, name) {
  const found = meta.links.find((l) => l.category === category && l.name === name);
  assert.ok(found, `"${category} / ${name}" link on "${meta.name}"`);
  return found.url;
}

function folders() {
  return S.fromLibraryItems([...api.library.values()]);
}

function folder(id) {
  return folders().find((f) => f.id === id);
}

test('search offers folders by name, and a new folder with the search text', async () => {
  const metas = await search('fav');
  assert.deepEqual(metas.map((m) => m.id), ['slib:fav', metas[1].id]);
  assert.match(metas[1].id, /^slib:do:new:[a-z0-9]{8}:0:/);
  assert.equal(metas[1].name, '＋ New folder "fav"');
  assert.deepEqual(await search(''), []);
  // "&" and "+" survive the trip through the catalog URL.
  assert.equal((await search('new folder: Rock & Roll + more'))[0].name, '＋ New folder "Rock & Roll + more"');
});

test('"new folder: <name>" creates the folder once, and updates the installed addon', async () => {
  const [card] = await search('new folder: Road trip');
  assert.equal(card.name, '＋ New folder "Road trip"');
  const page = await open(card.id);
  assert.equal(page.id, card.id);
  assert.equal(page.name, 'Road trip');
  assert.match(page.description, /^✓ Created "Road trip"/);
  assert.deepEqual(folders().map((f) => f.name), ['Favorites', 'Watch later', 'Road trip']);

  // Stremio asks again when you go back to the page: nothing new is made.
  assert.equal((await open(card.id)).description, 'This folder already exists.');
  assert.equal(folders().length, 3);

  // The manifest Stremio keeps for S-library gets the new row; other addons are left alone.
  for (let i = 0; i < 50 && api.collection.addons[0].manifest.catalogs.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(api.collection.addons[0].manifest.catalogs.map((c) => c.name), ['📁 S-library', '🔵 Favorites', '📁 Watch later', '📁 Road trip', 'S-library']);
  assert.deepEqual(api.collection.addons[1].manifest, { id: 'other' });
});

test('search hints explain the commands', async () => {
  const [empty] = await search('new folder:');
  assert.equal(empty.name, 'Type the folder name');
  assert.match((await open(empty.id)).description, /search for "new folder: "/);
  assert.equal((await search('rename Nothing: x'))[0].name, 'No folder by that name');
  assert.equal((await search('rename Favorites:'))[0].name, 'Type the new name');
  assert.equal((await search('describe Favorites:'))[0].name, 'Type the description');
});

test('renaming through search applies once; an old page changes nothing', async () => {
  const page = await open('slib:fav');
  assert.equal(linkTo(page, 'Folder', 'Rename'), 'stremio:///search?search=rename%20Favorites%3A%20');
  const [card] = await search('rename favorites: All-time favorites');
  assert.equal(card.name, 'Rename to "All-time favorites"');
  const renamed = await open(card.id);
  assert.equal(renamed.name, 'All-time favorites');
  assert.match(renamed.description, /^✓ Renamed to "All-time favorites"\.\n\nThe best ones$/);
  assert.equal(folder('fav').name, 'All-time favorites');

  // Opening the same card again (e.g. going back to it) doesn't rename the folder a second time.
  await open((await search('rename All-time favorites: Favorites'))[0].id);
  const stale = await open(card.id);
  assert.match(stale.description, /^This page was out of date/);
  assert.equal(folder('fav').name, 'Favorites');
});

test('describing through search', async () => {
  const [card] = await search('describe Favorites: Movies I could watch again & again');
  const page = await open(card.id);
  assert.match(page.description, /^✓ Description saved\.\n\nMovies I could watch again & again$/);
  assert.equal(folder('fav').description, 'Movies I could watch again & again');
});

test('color and icon links on the folder page', async () => {
  let page = await open('slib:fav');
  assert.ok(page.links.some((l) => l.category === 'Color' && l.name === '✓ 🔵 Blue'));
  page = await open(linkTo(page, 'Color', '🔴 Red'));
  assert.match(page.description, /^✓ Color changed to red\./);
  assert.equal(folder('fav').color, 'red');
  assert.match(page.poster, /\/img\/poster\/red\.png/);

  page = await open(linkTo(page, 'Icon', 'Romance'));
  assert.match(page.description, /^✓ Icon changed to romance\./);
  assert.equal(folder('fav').icon, 'heart');
  assert.ok(page.links.some((l) => l.category === 'Icon' && l.name === '✓ Romance'));

  page = await open(linkTo(page, 'Color', '📁 None'));
  assert.equal(folder('fav').color, null);
});

test('moving folders up and down', async () => {
  let page = await open('slib:fav');
  assert.ok(!page.links.some((l) => l.name === 'Move up'), 'the first folder has no "Move up"');
  page = await open(linkTo(page, 'Folder', 'Move down'));
  assert.equal(page.description.split('\n')[0], '✓ Moved down.');
  assert.deepEqual(folders().map((f) => f.id).slice(0, 2), ['later', 'fav']);
  await open(linkTo(page, 'Folder', 'Move up'));
  assert.deepEqual(folders().map((f) => f.id).slice(0, 2), ['fav', 'later']);
});

test('adding and taking out titles from their stream list, inside the app', async () => {
  const { streams } = await json(`/${config}/stream/movie/tt0111161.json`);
  const later = streams.find((s) => s.name === '📁 Watch later');
  let page = await open(later.externalUrl);
  assert.equal(page.name, 'Watch later');
  assert.match(page.description, /^✓ Added "The Shawshank Redemption" to this folder\./);
  assert.equal(linkTo(page, 'Folder', 'Back to "The Shawshank Redemption"'), 'stremio:///detail/movie/tt0111161');
  assert.deepEqual(folder('later').items.map((i) => i.id), ['tt0111161']);
  // Adding is safe to repeat.
  assert.match((await open(later.externalUrl)).description, /is already in this folder/);

  const again = (await json(`/${config}/stream/movie/tt0111161.json`)).streams.find((s) => s.name === '📁 Watch later');
  assert.equal(again.description, '✓ In this folder · tap to take it out');
  page = await open(again.externalUrl);
  assert.match(page.description, /^✓ Took "The Shawshank Redemption" out of this folder\./);
  assert.deepEqual(folder('later').items, []);
});

test('"New folder with this title" from a stream list', async () => {
  const { streams } = await json(`/${config}/stream/movie/tt0111161.json`);
  const page = await open(streams.at(-1).externalUrl);
  assert.equal(page.name, 'New folder');
  assert.match(page.description, /^✓ Created "New folder" with "The Shawshank Redemption" in it/);
  const created = folders().find((f) => f.name === 'New folder');
  assert.deepEqual(created.items.map((i) => i.id), ['tt0111161']);
  await open(linkTo(page, 'Folder', 'Delete'));
  await open(`slib:do:delete-now:${created.id}:${created.version}`);
});

test('deleting a folder asks first', async () => {
  let page = await open('slib:later');
  page = await open(linkTo(page, 'Folder', 'Delete'));
  assert.equal(page.name, 'Delete "Watch later"?');
  assert.ok(folder('later'), 'nothing is deleted before confirming');
  assert.equal(linkTo(page, 'Delete this folder?', 'No, keep it'), 'stremio:///detail/folder/slib%3Alater');
  page = await open(linkTo(page, 'Delete this folder?', 'Yes, delete "Watch later"'));
  assert.equal(page.name, 'S-library');
  assert.equal(page.description, '✓ Deleted "Watch later".');
  assert.equal(folder('later'), undefined);
  assert.equal(api.library.get('slib:later').type, 'slibrary-removed');
  assert.ok(!page.links.some((l) => l.name.endsWith('Watch later')));
  // The folder's own page is gone too.
  assert.equal((await fetch(`${base}/${config}/meta/folder/slib%3Alater.json`)).status, 404);
});

test('folders can be hidden from the Library and shown again', async () => {
  let page = await open('slib:fav');
  page = await open(linkTo(page, 'S-library', 'Hide folders from my Library'));
  assert.match(page.description, /^✓ Your folders are hidden from your Stremio Library/);
  assert.equal(api.library.get('slib:fav').removed, true);
  assert.equal(S.readSettings(api.library.values()).library, false);
  // Still there for S-library, and on the Board.
  assert.ok(folder('fav'));
  assert.ok((await json(`/${config}/catalog/folder/slib.json`)).metas.some((m) => m.id === 'slib:fav'));

  const show = linkTo(page, 'S-library', 'Show folders in my Library');
  await open(show);
  assert.equal(api.library.get('slib:fav').removed, false);
  assert.equal(S.readSettings(api.library.values()).library, true);
  // Going back to the old "Show" page doesn't switch anything.
  page = await open(linkTo(await open('slib:fav'), 'S-library', 'Hide folders from my Library'));
  assert.match((await open(show)).description, /^This page was out of date/);
  assert.equal(S.readSettings(api.library.values()).library, false);
  await open(linkTo(page, 'S-library', 'Show folders in my Library'));
});

test('broken or unknown links show the S-library page', async () => {
  const gone = await open('slib:do:color:nothere:0:red');
  assert.equal(gone.name, 'S-library');
  assert.equal(gone.description, "This folder doesn't exist anymore.");
  const version = folder('fav').version;
  assert.match((await open(`slib:do:color:fav:${version}:pink`)).description, /not available/);
  assert.match((await open(`slib:do:explode:fav:${version}`)).description, /does not know this link/);
  const expired = S.encodeConfig({ k: 'expired' });
  const { meta } = await (await fetch(`${base}/${expired}/meta/folder/${encodeURIComponent('slib:do:help:-:0:new')}.json`)).json();
  assert.match(meta.description, /^That didn't work: Session does not exist/);
});
