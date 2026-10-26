'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeApi } = require('./fake-stremio-api');
const S = require('../src/shared');

const none = new Map();
const favorites = S.toLibraryItems(
  {
    id: 'fav',
    name: 'Favorites',
    description: 'The best ones',
    color: 'blue',
    order: 0,
    items: [{ id: 'tt0133093', type: 'movie', name: 'The Matrix' }]
  },
  { baseUrl: 'https://old.host', previous: none, now: new Date('2026-01-01T00:00:00Z') }
);
const gone = S.toLibraryItems({ id: 'gone', name: 'Gone', items: [] }, { baseUrl: 'https://old.host', previous: none });
const deleted = S.deletionItems('gone', { previous: new Map(gone.map((item) => [item._id, item])) });
const movieItem = { _id: 'tt0111161', name: 'The Shawshank Redemption', type: 'movie', removed: false, temp: false, _mtime: '2026-01-01T00:00:00Z' };

let api;
let base;
let server;
let config;

test.before(async () => {
  api = await startFakeApi({ items: [...favorites, ...deleted, movieItem] });
  process.env.STREMIO_API_URL = api.url;
  const { createServer } = require('../src/server');
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  config = S.encodeConfig({ k: 'test-auth-key' });
});

test.after(() => {
  server.close();
  api.close();
});

async function get(path) {
  const res = await fetch(base + path);
  const type = res.headers.get('content-type');
  return { res, body: type.startsWith('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

async function post(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { res, body: await res.json() };
}

test('serves the configure page with and without a config', async () => {
  for (const path of ['/configure', `/${config}/configure`]) {
    const { res, body } = await get(path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(body.toString(), /<title>S-library<\/title>/);
  }
  const root = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/configure');
  assert.match((await get('/shared.js')).body.toString(), /SLibrary/);
});

test('base manifest requires configuration', async () => {
  const { res, body } = await get('/manifest.json');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(body.behaviorHints.configurationRequired, true);
  assert.equal(body.logo, `${base}/img/logo.png`);
});

test('configured manifest lists the folders from the Stremio library', async () => {
  const { body } = await get(`/${config}/manifest.json`);
  assert.equal(body.behaviorHints.configurationRequired, false);
  assert.deepEqual(body.catalogs.map((c) => c.name), ['📁 S-library', '🔵 Favorites']);
});

test('catalog, meta and stream routes use the current host', async () => {
  const folders = await get(`/${config}/catalog/folder/slib.json`);
  assert.deepEqual(folders.body.metas.map((m) => [m.id, m.poster]), [['slib:fav', `${base}/img/poster/blue.png`]]);

  const titles = await get(`/${config}/catalog/folder/slib.fav/skip=0.json`);
  assert.deepEqual(titles.body.metas.map((m) => m.id), ['tt0133093']);

  const meta = await get(`/${config}/meta/folder/slib%3Afav.json`);
  assert.equal(meta.body.meta.name, 'Favorites');
  assert.equal(meta.body.meta.links[1].url, `${base}/${config}/configure`);

  const missing = await get(`/${config}/meta/folder/slib:gone.json`);
  assert.equal(missing.res.status, 404);

  const stream = await get(`/${config}/stream/folder/slib:fav:movie:tt0133093.json`);
  assert.equal(stream.body.streams[0].externalUrl, 'stremio:///detail/movie/tt0133093');
});

test('honours forwarded headers for links, and assumes https away from this computer', async () => {
  const forwarded = await fetch(`${base}/manifest.json`, { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'slib.example' } });
  assert.equal((await forwarded.json()).logo, 'http://slib.example/img/logo.png');
  const proxied = await fetch(`${base}/manifest.json`, { headers: { 'x-forwarded-host': 'slib.example' } });
  assert.equal((await proxied.json()).logo, 'https://slib.example/img/logo.png');
});

test('a broken config or Stremio error degrades gracefully', async () => {
  const broken = await get('/nope/manifest.json');
  assert.equal(broken.body.behaviorHints.configurationRequired, true);
  const expired = S.encodeConfig({ k: 'expired' });
  const manifest = await get(`/${expired}/manifest.json`);
  assert.deepEqual(manifest.body.catalogs.map((c) => c.id), ['slib']);
  const catalog = await get(`/${expired}/catalog/folder/slib.json`);
  assert.deepEqual(catalog.body.metas, []);
});

test('serves folder artwork', async () => {
  const { res, body } = await get('/img/poster/blue.png');
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(body.subarray(1, 4).toString(), 'PNG');
  assert.equal((await get('/img/poster/nope.png')).res.status, 404);
});

test('proxies sign-in and library calls to the Stremio API', async () => {
  const login = await post('/api/login', { type: 'Login', email: 'me@example.com', password: 'secret', facebook: false });
  assert.equal(login.body.result.authKey, 'test-auth-key');
  const wrong = await post('/api/login', { type: 'Login', email: 'me@example.com', password: 'nope' });
  assert.equal(wrong.body.error.message, 'Wrong email or password');

  assert.equal((await post('/api/deleteUser', { authKey: 'test-auth-key' })).res.status, 404);
  assert.equal((await post('/api/datastoreGet', { authKey: 'test-auth-key', collection: 'other' })).res.status, 400);
});

test('saving a folder through the proxy shows up in the addon right away', async () => {
  // Warm the cache, then save a second folder the way the configure page does.
  await get(`/${config}/manifest.json`);
  const changes = S.toLibraryItems({ id: 'later', name: 'Watch later', color: 'green', order: 1, items: [] }, { baseUrl: base, previous: none });
  const put = await post('/api/datastorePut', { authKey: 'test-auth-key', collection: 'libraryItem', changes });
  assert.deepEqual(put.body.result, { success: true });
  const { body } = await get(`/${config}/manifest.json`);
  assert.deepEqual(body.catalogs.map((c) => c.name), ['📁 S-library', '🔵 Favorites', '🟢 Watch later']);
});

test('limits sign-in attempts per client', async () => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
  const attempt = () => fetch(`${base}/api/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'x', password: 'y' }) });
  for (let i = 0; i < 10; i++) assert.equal((await attempt()).status, 200);
  assert.equal((await attempt()).status, 429);
});
