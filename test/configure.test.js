// Drives the configure page in a real browser. Skipped unless Playwright is installed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeApi } = require('./fake-stremio-api');
const S = require('../src/shared');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  chromium = null;
}

const library = [
  ['tt0133093', 'movie', 'The Matrix'],
  ['tt0068646', 'movie', 'The Godfather'],
  ['tt0903747', 'series', 'Breaking Bad']
].map(([_id, type, name]) => ({ _id, type, name, removed: false, temp: false, _mtime: '2026-01-01T00:00:00Z' }));

test('create, edit, reorder and delete folders from the configure page', { skip: !chromium && 'Playwright is not installed' }, async (t) => {
  const api = await startFakeApi({ items: library, otherKeys: ['installed-key'] });
  process.env.STREMIO_API_URL = api.url;
  const server = require('../src/server').createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = S.encodeConfig({ k: 'test-auth-key' });
  const cinemeta = { transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: { id: 'com.linvo.cinemeta', catalogs: [] } };
  // Installed earlier, so its link has another sign-in key than this page will get.
  const installed = S.encodeConfig({ k: 'installed-key' });
  api.collection.addons = [cinemeta, { transportUrl: `${base}/${installed}/manifest.json`, manifest: { id: 'community.slibrary', catalogs: [] } }];

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    server.close();
    api.close();
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // A stand-in for Cinemeta: title details (with genres), genre lists (most popular first) and search.
  const movie = (id, name, popularity, imdbRating, releaseInfo) => ({ id, type: 'movie', name, popularity, imdbRating, releaseInfo });
  const cinemetaApi = {
    '/meta/movie/tt0133093.json': { meta: { id: 'tt0133093', genres: ['Action', 'Sci-Fi'] } },
    '/meta/movie/tt1375666.json': { meta: { id: 'tt1375666', genres: ['Action', 'Adventure', 'Sci-Fi'] } },
    '/catalog/movie/top/genre=Action.json': { metas: [movie('tt1375666', 'Inception', 90, '8.8', '2010'), movie('tt0468569', 'The Dark Knight', 50, '9.0', '2008'), movie('tt2911666', 'John Wick', 30, '7.4', '2014')] },
    '/catalog/movie/top/genre=Sci-Fi.json': { metas: [movie('tt0816692', 'Interstellar', 60, '8.7', '2014'), movie('tt1160419', 'Dune', 40, '8.0', '2021')] },
    '/catalog/movie/top/genre=Adventure.json': { metas: [movie('tt0816692', 'Interstellar', 60, '8.7', '2014'), movie('tt1160419', 'Dune', 40, '8.0', '2021')] },
    '/catalog/movie/top/search=incep.json': { metas: [{ id: 'tt1375666', type: 'movie', name: 'Inception', releaseInfo: '2010' }] }
  };
  await page.route('https://v3-cinemeta.strem.io/**', (route) => {
    const { pathname } = new URL(route.request().url());
    route.fulfill({ json: cinemetaApi[decodeURIComponent(pathname)] || { metas: [] } });
  });
  // What Stremio's servers hold (the fake API drops non-standard fields, like the real one).
  const stored = () => S.fromLibraryItems([...api.library.values()]);

  await page.goto(`${base}/configure`);
  // The running version, and what changed in it, closed until asked for.
  const { version } = require('../package.json');
  await page.waitForSelector('#version:not([hidden])');
  assert.equal(await page.textContent('#version'), `v${version}`);
  assert.equal(await page.getAttribute('#whats-new', 'open'), null);
  await page.click('#whats-new summary');
  assert.equal(await page.getAttribute('#whats-new', 'open'), '');
  assert.match(await page.textContent('#whats-new-label'), new RegExp(`v${version.replace(/\./g, '\\.')}`));
  assert.ok((await page.locator('.release').count()) >= 1);
  await page.fill('input[name=email]', 'me@example.com');
  await page.fill('input[name=password]', 'wrong');
  await page.click('#login-form button');
  await page.waitForSelector('#connect-error:not([hidden])');
  await page.fill('input[name=password]', 'secret');
  await page.click('#login-form button');
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.getAttribute('#install', 'href'), `${base}/${config}/manifest.json`.replace('http://', 'stremio://'));
  // Signing in brings the installed copy of the manifest up to date, e.g. after an update.
  for (let i = 0; i < 50 && api.collection.addons[1].manifest.version !== version; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(api.collection.addons[1].manifest.version, version);

  // A red folder with a title from the library and one found through search.
  await page.click('#new-folder');
  await page.fill('#f-name', 'Favorites');
  await page.fill('#f-description', 'All-time favorites');
  // Colors and icons are behind "+", and picking one closes the list again.
  assert.equal(await page.isVisible('#f-colors'), false);
  await page.click('#f-color-button');
  await page.click('.swatch[title=Red]');
  assert.equal(await page.isVisible('#f-colors'), false);
  assert.match(await page.textContent('#f-color-current'), /Red/);
  await page.click('#f-icon-button');
  assert.equal(await page.locator('.icon-option').count(), Object.keys(require('../icons/icons.json')).length + 1, 'every icon, and "No icon"');
  await page.click('.icon-option[title=Romance]');
  assert.equal(await page.isVisible('#f-icons'), false);
  assert.match(await page.textContent('#f-icon-current'), /Romance/);
  await page.waitForFunction(() => /red\.png\?name=Favorites&icon=heart$/.test(document.querySelector('#f-preview').src));
  await page.click('#f-results li:has-text("The Matrix") button');
  await page.click('[data-source=search]');
  await page.fill('#f-query', 'incep');
  await page.click('#f-results li:has-text("Inception") button');
  // Recommended: titles that share genres with the folder's, most popular first.
  await page.click('[data-source=recommended]');
  await page.waitForFunction(() => document.querySelectorAll('#f-results li').length === 4);
  assert.deepEqual(await page.locator('#f-results .title').evaluateAll((titles) => titles.map((t) => t.firstChild.textContent)),
    ['Interstellar', 'The Dark Knight', 'Dune', 'John Wick']);
  // The genres they come from, each of which can be left out, and used again.
  const genres = () => page.locator('#f-genres .genre').allTextContents();
  assert.deepEqual(await genres(), ['Action ✕', 'Sci-Fi ✕', 'Adventure ✕']);
  const recommended = () => page.locator('#f-results .title').evaluateAll((titles) => titles.map((t) => t.firstChild.textContent));
  await page.click('#f-genres .genre:has-text("Sci-Fi")');
  await page.click('#f-genres .genre:has-text("Adventure")');
  await page.waitForFunction(() => document.querySelectorAll('#f-results li').length === 2);
  assert.deepEqual(await recommended(), ['The Dark Knight', 'John Wick']);
  assert.deepEqual(await genres(), ['Action ✕', '+ Sci-Fi', '+ Adventure']);
  await page.click('#f-genres .genre:has-text("Action")');
  await page.waitForSelector('#f-results-hint:has-text("Every genre is left out")');
  assert.equal(await page.locator('#f-results li').count(), 0);
  for (const genre of ['Action', 'Sci-Fi', 'Adventure']) await page.click(`#f-genres .genre:has-text("${genre}")`);
  await page.waitForFunction(() => document.querySelectorAll('#f-results li').length === 4);
  assert.deepEqual(await recommended(), ['Interstellar', 'The Dark Knight', 'Dune', 'John Wick']);
  // Sorted by rating or by year instead.
  await page.click('#f-sorts .sort:has-text("Best rated")');
  assert.deepEqual(await recommended(), ['The Dark Knight', 'Interstellar', 'Dune', 'John Wick']);
  assert.match(await page.textContent('#f-results li:has-text("The Dark Knight") small'), /2008 · ★ 9\.0/);
  await page.click('#f-sorts .sort:has-text("Newest")');
  assert.deepEqual(await recommended(), ['Dune', 'Interstellar', 'John Wick', 'The Dark Knight']);
  await page.click('#f-sorts .sort:has-text("Most popular")');
  assert.deepEqual(await recommended(), ['Interstellar', 'The Dark Knight', 'Dune', 'John Wick']);
  await page.click('#f-results li:has-text("Interstellar") button');
  await page.click('#f-save');
  await page.waitForSelector('.folder');

  // A second folder without a color: the previous color must not stick. It has no icon, and
  // its name is left off the poster.
  await page.click('#new-folder');
  assert.match(await page.textContent('#f-color-current'), /No color/);
  await page.click('[data-source=recommended]');
  assert.match(await page.textContent('#f-results-hint'), /Add a few movies or shows first/);
  await page.click('[data-source=library]');
  await page.click('#f-results li:has-text("Breaking Bad") button');
  await page.fill('#f-name', 'Watch later');
  await page.click('#f-icon-button');
  await page.click('.icon-option[title="No icon"]');
  await page.uncheck('#f-show-name');
  await page.waitForFunction(() => /\/img\/poster\/none\.png\?icon=none$/.test(document.querySelector('#f-preview').src));
  // The buttons stay on screen on a phone, however long the editor is.
  await page.setViewportSize({ width: 390, height: 640 });
  const save = await page.locator('#f-save').boundingBox();
  assert.ok(save.y + save.height <= 640, `Save is on screen (bottom at ${save.y + save.height})`);
  await page.click('#f-save');
  await page.waitForFunction(() => document.querySelectorAll('.folder').length === 2);

  let folders = stored();
  assert.deepEqual(folders.map((f) => [f.name, f.color, f.items.map((i) => i.id)]), [
    ['Favorites', 'red', ['tt0133093', 'tt1375666', 'tt0816692']],
    ['Watch later', null, ['tt0903747']]
  ]);
  assert.equal(folders[0].description, 'All-time favorites');
  assert.deepEqual([folders[0].icon, folders[0].showName], ['heart', true]);
  assert.deepEqual([folders[1].icon, folders[1].showName], ['none', false]);
  assert.equal(await page.getAttribute('.folder >> nth=1 >> img', 'src'), `${base}/img/poster/none.png?icon=none`);

  // Reorder, then rename and take a title out through the editor.
  await page.click('button[aria-label="Move Watch later up"]');
  await page.waitForFunction(() => document.querySelector('.folder-name').textContent === 'Watch later');
  await page.click('.folder >> nth=1 >> text=Edit');
  await page.fill('#f-name', 'Best of all time');
  await page.click('button[aria-label="Remove The Matrix"]');
  await page.click('#f-save');
  await page.waitForSelector('.folder-name:has-text("Best of all time")');
  folders = stored();
  assert.deepEqual(folders.map((f) => [f.name, f.items.map((i) => i.id)]), [
    ['Watch later', ['tt0903747']],
    ['Best of all time', ['tt1375666', 'tt0816692']]
  ]);

  // The installed copy of the manifest picks up the folder rows (refreshed in the background);
  // other addons are untouched.
  const rows = () => api.collection.addons[1].manifest.catalogs.map((c) => c.name).join(' | ');
  const expected = '📁 S-library | 📁 Watch later | 🔴 Best of all time | S-library';
  for (let i = 0; i < 50 && rows() !== expected; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(rows(), expected);
  assert.deepEqual(api.collection.addons[0], cinemeta);

  // Reopening from Stremio's "Configure" button signs in from the addon link and shows
  // the folders as stored, titles included; then delete one.
  // A title was played from a folder on a TV in the meantime: Stremio stored it on the folder.
  const playedId = [...api.library.keys()].find((id) => /^slib:[a-z0-9]+$/.test(id) && api.library.get(id).type === 'folder');
  api.library.get(playedId).state = { ...api.library.get(playedId).state, video_id: `${playedId}:movie:tt1375666`, timeOffset: 1000 };
  await page.goto(`${base}/${config}/configure`);
  await page.waitForSelector('#app:not([hidden])');
  assert.deepEqual(await page.locator('.folder-meta').allTextContents(), ['1 title', '2 titles']);
  // Opening the page clears it, so the folder opens as a folder again.
  for (let i = 0; i < 50 && api.library.get(playedId).state.timeOffset !== 0; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual([api.library.get(playedId).state.video_id, api.library.get(playedId).state.timeOffset], [null, 0]);
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('.folder >> nth=0 >> text=Edit');
  await page.click('#f-delete');
  await page.waitForFunction(() => document.querySelectorAll('.folder').length === 1);
  assert.deepEqual(stored().map((f) => f.name), ['Best of all time']);

  // Links from Stremio's folder pages and stream lists open the editor directly.
  const best = stored()[0];
  await page.goto('about:blank');
  await page.goto(`${base}/${config}/configure#folder=${best.id}`);
  await page.waitForSelector('#editor[open]');
  assert.equal(await page.inputValue('#f-name'), 'Best of all time');
  assert.equal(await page.isChecked('.icon-option[title=Romance] input'), true);
  await page.click('#f-cancel');
  assert.equal(new URL(page.url()).hash, '', 'the link is used once');

  await page.goto('about:blank');
  await page.goto(`${base}/${config}/configure#new=movie:tt0068646`);
  await page.waitForSelector('#editor[open] #f-items li:has-text("The Godfather")');
  await page.fill('#f-name', 'Classics');
  await page.click('#f-save');
  await page.waitForSelector('.folder-name:has-text("Classics")');
  assert.deepEqual(stored().find((f) => f.name === 'Classics').items.map((i) => i.id), ['tt0068646']);

  // Folders can be hidden from Stremio's Library, and shown there again.
  const inLibrary = () => [...api.library.values()].filter((item) => item.type === 'folder' && !item.removed).length;
  assert.equal(await page.isChecked('#show-in-library'), true);
  assert.equal(inLibrary(), 2);
  await page.click('#show-in-library');
  await page.waitForSelector('#show-in-library:not(:checked):enabled');
  assert.equal(inLibrary(), 0);
  assert.deepEqual(stored().map((f) => f.name), ['Best of all time', 'Classics'], 'hidden folders are still folders');
  await page.goto('about:blank');
  await page.goto(`${base}/${config}/configure`);
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.isChecked('#show-in-library'), false);
  await page.click('#show-in-library');
  await page.waitForSelector('#show-in-library:checked:enabled');
  assert.equal(inLibrary(), 2);

  // Folders can be left out of Discover (and so the Board), which updates the installed addon,
  // and out of search.
  await page.click('#show-in-discover');
  await page.waitForSelector('#show-in-discover:not(:checked):enabled');
  for (let i = 0; i < 50 && rows() !== 'S-library'; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(rows(), 'S-library');
  await page.click('#show-in-search');
  await page.waitForSelector('#show-in-search:not(:checked):enabled');
  assert.equal(await page.isVisible('#nowhere'), false);
  await page.click('#show-in-library');
  await page.waitForSelector('#nowhere:not([hidden])');
  const settings = S.readSettings(api.library.values());
  assert.deepEqual([settings.library, settings.discover, settings.search], [false, false, false]);

  // Recent requests from Stremio apps (here: the page itself, refreshing the installed addon).
  await page.click('#recent summary');
  await page.waitForSelector('#recent-list li');
  assert.match(await page.textContent('#recent-list li'), /manifest → ✓ 200/);
  assert.deepEqual(errors, []);
});
