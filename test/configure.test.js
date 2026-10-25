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
  const api = await startFakeApi({ items: library });
  process.env.STREMIO_API_URL = api.url;
  const server = require('../src/server').createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = S.encodeConfig({ k: 'test-auth-key' });
  const cinemeta = { transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: { id: 'com.linvo.cinemeta', catalogs: [] } };
  api.collection.addons = [cinemeta, { transportUrl: `${base}/${config}/manifest.json`, manifest: { id: 'community.slibrary', catalogs: [] } }];

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    server.close();
    api.close();
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route('https://v3-cinemeta.strem.io/**', (route) => route.fulfill({
    json: { metas: route.request().url().includes('/movie/') ? [{ id: 'tt1375666', type: 'movie', name: 'Inception', releaseInfo: '2010' }] : [] }
  }));
  // What Stremio's servers hold (the fake API drops non-standard fields, like the real one).
  const stored = () => S.fromLibraryItems([...api.library.values()]);

  await page.goto(`${base}/configure`);
  await page.fill('input[name=email]', 'me@example.com');
  await page.fill('input[name=password]', 'wrong');
  await page.click('#login-form button');
  await page.waitForSelector('#connect-error:not([hidden])');
  await page.fill('input[name=password]', 'secret');
  await page.click('#login-form button');
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.getAttribute('#install', 'href'), `${base}/${config}/manifest.json`.replace('http://', 'stremio://'));

  // A red folder with a title from the library and one found through search.
  await page.click('#new-folder');
  await page.fill('#f-name', 'Favorites');
  await page.fill('#f-description', 'All-time favorites');
  await page.click('.swatch[title=Red]');
  await page.click('#f-results li:has-text("The Matrix") button');
  await page.click('[data-source=search]');
  await page.fill('#f-query', 'incep');
  await page.click('#f-results li:has-text("Inception") button');
  await page.click('#f-save');
  await page.waitForSelector('.folder');

  // A second folder without a color: the previous color must not stick.
  await page.click('#new-folder');
  await page.click('#f-results li:has-text("Breaking Bad") button');
  await page.fill('#f-name', 'Watch later');
  await page.click('#f-save');
  await page.waitForFunction(() => document.querySelectorAll('.folder').length === 2);

  let folders = stored();
  assert.deepEqual(folders.map((f) => [f.name, f.color, f.items.map((i) => i.id)]), [
    ['Favorites', 'red', ['tt0133093', 'tt1375666']],
    ['Watch later', null, ['tt0903747']]
  ]);
  assert.equal(folders[0].description, 'All-time favorites');

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
    ['Best of all time', ['tt1375666']]
  ]);

  // The installed copy of the manifest picks up the folder rows (refreshed in the background);
  // other addons are untouched.
  const rows = () => api.collection.addons[1].manifest.catalogs.map((c) => c.name).join(' | ');
  for (let i = 0; i < 50 && rows() !== '📁 S-library | 📁 Watch later | 🔴 Best of all time'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(rows(), '📁 S-library | 📁 Watch later | 🔴 Best of all time');
  assert.deepEqual(api.collection.addons[0], cinemeta);

  // Reopening from Stremio's "Configure" button signs in from the addon link and shows
  // the folders as stored, titles included; then delete one.
  await page.goto(`${base}/${config}/configure`);
  await page.waitForSelector('#app:not([hidden])');
  assert.deepEqual(await page.locator('.folder-meta').allTextContents(), ['1 title', '1 title']);
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('.folder >> nth=0 >> text=Edit');
  await page.click('#f-delete');
  await page.waitForFunction(() => document.querySelectorAll('.folder').length === 1);
  assert.deepEqual(stored().map((f) => f.name), ['Best of all time']);
  assert.deepEqual(errors, []);
});
