'use strict';

const test = require('node:test');
const http = require('node:http');
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
// A folder deleted with Stremio's own "Remove from library" button, back when that deleted it.
const removedByStremio = { ...S.toLibraryItems({ id: 'old', name: 'Old', items: [] }, { baseUrl: 'https://old.host', previous: none })[0], removed: true };
const movieItem = { _id: 'tt0111161', name: 'The Shawshank Redemption', type: 'movie', removed: false, temp: false, _mtime: '2026-01-01T00:00:00Z' };

let api;
let base;
let server;
let config;

test.before(async () => {
  api = await startFakeApi({
    otherKeys: ['installed-key'],
    items: [...favorites, ...deleted, removedByStremio, movieItem],
    cinemeta: { tt1375666: { id: 'tt1375666', type: 'movie', name: 'Inception', poster: 'https://example.com/inception.jpg' } }
  });
  process.env.STREMIO_API_URL = api.url;
  process.env.CINEMETA_URL = api.url;
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

test('reports the running version and what changed, kept in step with package.json', async () => {
  const { body } = await get('/version.json');
  assert.equal(body.version, require('../package.json').version);
  assert.equal(body.changes[0].version, body.version, 'CHANGELOG.md starts with the current version');
  for (const entry of body.changes) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.changes.length > 0, `${entry.version} lists its changes`);
  }
  const manifest = await get('/manifest.json');
  assert.equal(manifest.body.version, body.version);
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
  assert.deepEqual(body.catalogs.map((c) => c.name), ['📁 S-library', '🔵 Favorites', 'S-library']);
  // The first read brings the account up to date: the folder deleted the old way stays deleted.
  assert.equal(api.library.get('slib:old').type, 'slibrary-removed');
  assert.equal(S.readSettings(api.library.values()).keep, true);
});

test('catalog, meta and stream routes use the current host', async () => {
  const folders = await get(`/${config}/catalog/folder/slib.json`);
  assert.deepEqual(folders.body.metas.map((m) => [m.id, m.poster]), [['slib:fav', `${base}/img/poster/blue.png?name=Favorites`]]);

  const titles = await get(`/${config}/catalog/folder/slib.fav/skip=0.json`);
  assert.deepEqual(titles.body.metas.map((m) => m.id), ['tt0133093']);

  const meta = await get(`/${config}/meta/folder/slib%3Afav.json`);
  assert.equal(meta.body.meta.name, 'Favorites');
  assert.ok(meta.body.meta.links.some((l) => l.url === `${base}/${config}/configure#folder=fav`));

  const missing = await get(`/${config}/meta/folder/slib:gone.json`);
  assert.equal(missing.res.status, 404);

  const stream = await get(`/${config}/stream/folder/slib:fav:movie:tt0133093.json`);
  assert.ok(stream.body.streams.some((s) => s.externalUrl === 'stremio:///detail/movie/tt0133093'));
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
  assert.deepEqual(manifest.body.catalogs.map((c) => c.id), ['slib', 'slib.search']);
  const catalog = await get(`/${expired}/catalog/folder/slib.json`);
  assert.deepEqual(catalog.body.metas, []);
});

test('serves folder artwork, with the folder name on posters', async () => {
  const { res, body } = await get('/img/poster/blue.png');
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(body.subarray(1, 4).toString(), 'PNG');
  const named = await get('/img/poster/blue.png?name=Watch%20later');
  assert.equal(named.res.status, 200);
  assert.notDeepEqual(named.body, body);
  assert.equal((await get('/img/poster/nope.png?name=x')).res.status, 404);
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
  assert.deepEqual(body.catalogs.map((c) => c.name), ['📁 S-library', '🔵 Favorites', '🟢 Watch later', 'S-library']);
});

test("a movie's stream list offers S-library's folders", async () => {
  // Stremio Web (a browser, which sends an Origin header) gets web pages.
  const web = await (await fetch(`${base}/${config}/stream/movie/tt0111161.json`, { headers: { origin: 'https://web.stremio.com' } })).json();
  assert.equal(web.streams[0].description, '＋ Tap to add it to this folder');
  assert.equal(web.streams[0].externalUrl, `${base}/${config}/act/add/fav/movie/tt0111161`);
  assert.match(web.streams.at(-1).externalUrl, /configure#new=movie%3Att0111161$/);
  // The Stremio apps get pages inside Stremio.
  const { body } = await get(`/${config}/stream/movie/tt0111161.json`);
  assert.equal(body.streams[0].externalUrl, `stremio:///detail/folder/${encodeURIComponent('slib:do:add:fav:0:movie:tt0111161')}`);
  assert.match(body.streams.at(-1).externalUrl, /^stremio:\/\/\/detail\/folder\/slib%3Ado%3Anew-with%3A[a-z0-9]{8}%3A0%3Amovie%3Att0111161$/);
  // Without a configured account there is nothing to offer.
  assert.deepEqual((await get('/nope/stream/movie/tt0111161.json')).body.streams, []);
});

test('adding a title from the stream list stores it and confirms', async () => {
  const add = await fetch(`${base}/${config}/act/add/fav/movie/tt0111161`);
  const page = await add.text();
  assert.equal(add.status, 200);
  assert.match(page, /✓ Added &quot;The Shawshank Redemption&quot; to &quot;Favorites&quot;/);
  assert.match(page, /href="stremio:\/\/\/detail\/movie\/tt0111161"/);
  assert.match(page, new RegExp(`href="${base}/${config}/configure#folder=fav"`));
  assert.doesNotMatch(page, /Undo/);
  let [folder] = S.fromLibraryItems([...api.library.values()]);
  assert.deepEqual(folder.items.map((item) => item.id), ['tt0133093', 'tt0111161']);
  // The stream list now shows it's in the folder.
  const { body } = await get(`/${config}/stream/movie/tt0111161.json`);
  assert.equal(body.streams[0].description, '✓ Already in this folder');

  // A title that isn't in the library gets its name from Cinemeta.
  await fetch(`${base}/${config}/act/add/fav/movie/tt1375666`);
  [folder] = S.fromLibraryItems([...api.library.values()]);
  assert.deepEqual(folder.items.at(-1), { id: 'tt1375666', type: 'movie', name: 'Inception', poster: 'https://example.com/inception.jpg' });

  // Titles are taken out of folders on the configure page, not from Stremio.
  assert.equal((await fetch(`${base}/${config}/act/remove/fav/movie/tt0111161`)).status, 404);
  [folder] = S.fromLibraryItems([...api.library.values()]);
  assert.deepEqual(folder.items.map((item) => item.id), ['tt0133093', 'tt0111161', 'tt1375666']);
});

test('a folder action explains what went wrong', async () => {
  const missing = await fetch(`${base}/${config}/act/add/nothere/movie/tt0111161`);
  assert.equal(missing.status, 502);
  assert.match(await missing.text(), /doesn&#39;t exist anymore/);
  const broken = await fetch(`${base}/nope/act/add/fav/movie/tt0111161`);
  assert.equal(broken.status, 400);
});

test('serves the icons for the configure page', async () => {
  const { body } = await get('/icons.json');
  assert.ok(body.folder && body.western && body.spy && body.heart);
  assert.match(body.western.path, /^M/);
  const poster = await get('/img/poster/brown.png?name=Western&icon=western');
  assert.equal(poster.res.status, 200);
  assert.notDeepEqual(poster.body, (await get('/img/poster/brown.png?name=Western')).body);
});

test("Stremio's own \"Remove from library\" only takes a folder out of the Library", async () => {
  const fav = api.library.get('slib:fav');
  // What Stremio does when you press the button on the folder's page.
  await post('/api/datastorePut', { authKey: 'test-auth-key', collection: 'libraryItem', changes: [{ ...fav, removed: true }] });
  const { body } = await get(`/${config}/catalog/folder/slib.json`);
  assert.ok(body.metas.some((m) => m.id === 'slib:fav'), 'the folder is still there');
  await post('/api/datastorePut', { authKey: 'test-auth-key', collection: 'libraryItem', changes: [{ ...fav, removed: false }] });
});

test('shows each account the requests its Stremio apps made, without auth keys', async () => {
  // The TV uses the addon link installed earlier, with another sign-in key than this page.
  const installed = S.encodeConfig({ k: 'installed-key' });
  const tv = { 'user-agent': 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36', origin: 'file://' };
  const { meta } = await (await fetch(`${base}/${installed}/meta/folder/slib%3Afav.json`, { headers: tv })).json();
  assert.deepEqual(meta.videos.map((v) => v.id), ['slib:fav:movie:tt0133093', 'slib:fav:movie:tt0111161', 'slib:fav:movie:tt1375666'], 'TVs get the titles as a list');
  await fetch(`${base}/${installed}/meta/folder/slib%3Afav/oddly-shaped/request.json`, { headers: tv });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const { body } = await get(`/${config}/recent.json`);
  assert.deepEqual(body.requests.slice(0, 2).map((r) => [r.app, r.what, r.result]), [
    ['Samsung TV, web version', 'unknown request: /meta/folder/slib:fav/oddly-shaped/request.json', 404],
    ['Samsung TV, web version', 'meta folder slib:fav', 200]
  ]);
  const text = JSON.stringify(body);
  assert.ok(!text.includes('test-auth-key') && !text.includes('installed-key') && !text.includes(config) && !text.includes(installed));
  // Other accounts see only their own.
  assert.deepEqual((await get(`/${S.encodeConfig({ k: 'someone-else' })}/recent.json`)).body.requests, []);
  assert.equal((await get('/nope/recent.json')).res.status, 404);
});

test('on a TV, a title in a folder plays with streams from the account\'s other addons', async (t) => {
  // A stream addon like the ones Stremio users install, and one that offers no movies.
  const asked = [];
  const streamAddon = http.createServer((req, res) => {
    asked.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ streams: req.url === '/stream/movie/tt0133093.json' ? [{ name: 'Fake\n1080p', url: 'https://example.com/matrix.mp4' }, { infoHash: 'a'.repeat(40) }] : [] }));
  });
  await new Promise((resolve) => streamAddon.listen(0, '127.0.0.1', resolve));
  t.after(() => streamAddon.close());
  const addonBase = `http://127.0.0.1:${streamAddon.address().port}`;
  process.env.ALLOW_PRIVATE_ADDON_URLS = '1';
  t.after(() => delete process.env.ALLOW_PRIVATE_ADDON_URLS);
  api.collection.addons = [
    { transportUrl: `${base}/${config}/manifest.json`, manifest: { id: 'community.slibrary', name: 'S-library', resources: ['stream'], types: ['movie'] } },
    { transportUrl: `${addonBase}/manifest.json`, manifest: { id: 'fake.streams', name: 'Fake streams', resources: ['stream'], types: ['movie', 'series'], idPrefixes: ['tt'] } },
    { transportUrl: `${addonBase}/other/manifest.json`, manifest: { id: 'fake.tv', name: 'TV only', resources: [{ name: 'stream', types: ['tv'] }], types: ['movie'] } }
  ];
  const tv = { 'user-agent': 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36' };
  const { streams } = await (await fetch(`${base}/${config}/stream/folder/${encodeURIComponent('slib:fav:movie:tt0133093')}.json`, { headers: tv })).json();
  assert.deepEqual(streams, [
    { name: 'Fake\n1080p', url: 'https://example.com/matrix.mp4' },
    { name: 'Fake streams', infoHash: 'a'.repeat(40) }
  ]);
  assert.deepEqual(asked, ['/stream/movie/tt0133093.json'], 'only addons that serve movies are asked, and not S-library');
  // Elsewhere (e.g. the phone, opening the folder after it was played from on the TV) the
  // whole folder is listed, each title opening its page.
  const phone = (await get(`/${config}/stream/folder/${encodeURIComponent('slib:fav:movie:tt0133093')}.json`)).body.streams;
  assert.deepEqual(phone.map((s) => s.name), ['🖼️ Show as posters', 'The Matrix', 'The Shawshank Redemption', 'Inception']);
  assert.equal(phone[1].externalUrl, 'stremio:///detail/movie/tt0133093');
});

test('only asks addons on public https addresses for streams', () => {
  const { reachableAddon } = require('../src/stremio-api');
  assert.equal(reachableAddon('https://torrentio.strem.fun/config/manifest.json'), true);
  for (const url of ['http://addon.example/manifest.json', 'https://localhost/manifest.json', 'https://127.0.0.1:7000/manifest.json',
    'https://192.168.1.5/manifest.json', 'https://10.0.0.2/manifest.json', 'https://172.20.0.1/manifest.json', 'https://[::1]/manifest.json',
    'https://nas.local/manifest.json', 'https://addon.example/other.json', 'not a url']) {
    assert.equal(reachableAddon(url), false, url);
  }
  assert.equal(reachableAddon('https://fd-addon.example/manifest.json'), true, 'a host name, not an address');
});

test('clears watch progress Stremio stored on a folder', async () => {
  // What Stremio writes after a title was played from the folder on a TV.
  const fav = api.library.get('slib:fav');
  const played = { ...fav, state: { ...fav.state, video_id: 'slib:fav:movie:tt0133093', timeOffset: 600000, duration: 8160000 } };
  await post('/api/datastorePut', { authKey: 'test-auth-key', collection: 'libraryItem', changes: [played] });
  await get(`/${config}/catalog/folder/slib.json`);
  const state = api.library.get('slib:fav').state;
  assert.deepEqual([state.video_id, state.timeOffset, state.duration], [null, 0, 0]);
});

test('limits sign-in attempts per client', async () => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
  const attempt = () => fetch(`${base}/api/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'x', password: 'y' }) });
  for (let i = 0; i < 10; i++) assert.equal((await attempt()).status, 200);
  assert.equal((await attempt()).status, 429);
});
