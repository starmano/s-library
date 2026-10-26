'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const addon = require('../src/addon');

const ctx = {
  baseUrl: 'https://addon.test',
  manifestUrl: 'https://addon.test/cfg/manifest.json',
  configureUrl: 'https://addon.test/cfg/configure',
  actionUrl: 'https://addon.test/cfg/act'
};

const folders = [
  {
    id: 'fav',
    name: 'Favorites',
    description: 'The best ones',
    color: 'red',
    order: 0,
    icon: 'folder',
    version: 5,
    items: [
      { id: 'tt0133093', type: 'movie', name: 'The Matrix' },
      { id: 'kitsu:1', type: 'series', name: 'Cowboy Bebop', poster: 'https://example.com/bebop.jpg' }
    ]
  },
  { id: 'later', name: 'Watch later', description: '', color: null, order: 1, icon: 'folder', version: 0, items: [] }
];
const library = { folders, settings: { library: true, version: 0 } };

test('unconfigured manifest asks to be configured', () => {
  const manifest = addon.manifest(null, ctx);
  assert.equal(manifest.name, 'S-library');
  assert.deepEqual(manifest.catalogs, []);
  assert.deepEqual(manifest.behaviorHints, { configurable: true, configurationRequired: true });
});

test('configured manifest has one catalog per folder, marked with its color', () => {
  const manifest = addon.manifest(folders, ctx);
  assert.equal(manifest.behaviorHints.configurationRequired, false);
  assert.deepEqual(manifest.types, ['folder', 'movie', 'series', 'anime']);
  assert.equal(manifest.idPrefixes, undefined, 'a manifest-wide prefix would hide movies from the stream resource');
  assert.deepEqual(manifest.resources, [
    'catalog',
    { name: 'meta', types: ['folder'], idPrefixes: ['slib:'] },
    { name: 'stream', types: ['folder', 'movie', 'series', 'anime'] }
  ]);
  assert.deepEqual(
    manifest.catalogs.map((c) => [c.id, c.name]),
    [
      ['slib', '📁 S-library'],
      ['slib.fav', '🔴 Favorites'],
      ['slib.later', '📁 Watch later'],
      ['slib.search', 'S-library']
    ]
  );
});

test('the S-library catalog lists the folders themselves', () => {
  const { metas } = addon.catalog(folders, 'slib', {}, ctx);
  assert.equal(metas.length, 2);
  assert.deepEqual(metas[0], {
    id: 'slib:fav',
    type: 'folder',
    name: 'Favorites',
    poster: 'https://addon.test/img/poster/red.png?name=Favorites',
    posterShape: 'poster',
    background: 'https://addon.test/img/bg/red.png',
    description: 'The best ones',
    releaseInfo: '2 titles'
  });
  assert.equal(metas[1].releaseInfo, '0 titles');
});

test('a folder catalog lists its titles, with pagination', () => {
  const { metas } = addon.catalog(folders, 'slib.fav', {}, ctx);
  assert.deepEqual(metas, [
    { id: 'tt0133093', type: 'movie', name: 'The Matrix', poster: 'https://images.metahub.space/poster/medium/tt0133093/img' },
    { id: 'kitsu:1', type: 'series', name: 'Cowboy Bebop', poster: 'https://example.com/bebop.jpg' }
  ]);
  const big = [{ ...folders[0], items: Array.from({ length: 150 }, (_, i) => ({ id: `tt${i}`, type: 'movie', name: `#${i}` })) }];
  assert.equal(addon.catalog(big, 'slib.fav', {}, ctx).metas.length, addon.PAGE_SIZE);
  assert.equal(addon.catalog(big, 'slib.fav', { skip: '100' }, ctx).metas[0].name, '#100');
  assert.deepEqual(addon.catalog(folders, 'slib.missing', {}, ctx).metas, []);
});

test('folder meta has description and links to its titles', () => {
  const meta = addon.meta(library, 'slib:fav', ctx);
  assert.equal(meta.name, 'Favorites');
  assert.equal(meta.description, 'The best ones');
  assert.deepEqual(meta.links[0], {
    name: 'Open as a grid',
    category: 'Folder',
    url: `stremio:///discover/${encodeURIComponent(ctx.manifestUrl)}/folder/slib.fav`
  });
  const titles = meta.links.filter((l) => l.category === 'In this folder');
  assert.deepEqual(titles.map((l) => l.url), ['stremio:///detail/movie/tt0133093', 'stremio:///detail/series/kitsu%3A1']);
  assert.ok(meta.links.some((l) => l.name === 'Edit on the web' && l.url === `${ctx.configureUrl}#folder=fav`));
  assert.deepEqual(meta.videos.map((v) => v.id), ['slib:fav:movie:tt0133093', 'slib:fav:series:kitsu:1']);
  assert.equal(addon.meta(library, 'slib:missing', ctx), null);
});

test("a title's stream list offers every folder, and a new one", () => {
  assert.deepEqual(addon.stream(folders, 'movie', 'tt0133093', ctx).streams, [
    { name: '🔴 Favorites', description: '✓ In this folder · tap to take it out', externalUrl: 'https://addon.test/cfg/act/remove/fav/movie/tt0133093' },
    { name: '📁 Watch later', description: '＋ Add to this folder', externalUrl: 'https://addon.test/cfg/act/add/later/movie/tt0133093' },
    { name: '📁 S-library', description: '＋ New folder with this title', externalUrl: 'https://addon.test/cfg/configure#new=movie%3Att0133093' }
  ]);
  // Episodes act on their show.
  const episode = addon.stream(folders, 'series', 'kitsu:1:5', ctx).streams;
  assert.equal(episode[0].externalUrl, 'https://addon.test/cfg/act/remove/fav/series/kitsu%3A1');
  assert.equal(addon.stream([], 'series', 'tt0944947:1:1', ctx).streams[0].externalUrl, 'https://addon.test/cfg/configure#new=series%3Att0944947');
});

test('a title in a folder can be opened or taken out from the folder page', () => {
  assert.deepEqual(addon.stream(folders, 'folder', 'slib:fav:series:kitsu:1', ctx).streams, [
    { name: '📁 S-library', description: 'Open "Cowboy Bebop"', externalUrl: 'stremio:///detail/series/kitsu%3A1' },
    { name: '📁 S-library', description: '✕ Take it out of "Favorites"', externalUrl: 'https://addon.test/cfg/act/remove/fav/series/kitsu%3A1' }
  ]);
  // An empty folder's page explains how to fill it.
  assert.match(addon.stream(folders, 'folder', 'slib:later', ctx).streams[0].description, /folder is empty/);
  assert.deepEqual(addon.stream(folders, 'folder', 'slib:missing', ctx).streams, []);
});

test('episode ids map to their show', () => {
  assert.equal(addon.titleOf('tt0944947:1:1'), 'tt0944947');
  assert.equal(addon.titleOf('tt0133093'), 'tt0133093');
  assert.equal(addon.titleOf('kitsu:123:4'), 'kitsu:123');
  assert.equal(addon.titleOf('kitsu:123'), 'kitsu:123');
});
