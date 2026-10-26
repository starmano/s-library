'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const addon = require('../src/addon');

const ctx = {
  baseUrl: 'https://addon.test',
  manifestUrl: 'https://addon.test/cfg/manifest.json',
  configureUrl: 'https://addon.test/cfg/configure'
};

const folders = [
  {
    id: 'fav',
    name: 'Favorites',
    description: 'The best ones',
    color: 'red',
    order: 0,
    items: [
      { id: 'tt0133093', type: 'movie', name: 'The Matrix' },
      { id: 'kitsu:1', type: 'series', name: 'Cowboy Bebop', poster: 'https://example.com/bebop.jpg' }
    ]
  },
  { id: 'later', name: 'Watch later', description: '', color: null, order: 1, items: [] }
];

test('unconfigured manifest asks to be configured', () => {
  const manifest = addon.manifest(null, ctx);
  assert.equal(manifest.name, 'S-library');
  assert.deepEqual(manifest.catalogs, []);
  assert.deepEqual(manifest.behaviorHints, { configurable: true, configurationRequired: true });
});

test('configured manifest has one catalog per folder, marked with its color', () => {
  const manifest = addon.manifest(folders, ctx);
  assert.equal(manifest.behaviorHints.configurationRequired, false);
  assert.deepEqual(manifest.types, ['folder']);
  assert.deepEqual(manifest.idPrefixes, ['slib:']);
  assert.deepEqual(
    manifest.catalogs.map((c) => [c.id, c.name]),
    [
      ['slib', '📁 S-library'],
      ['slib.fav', '🔴 Favorites'],
      ['slib.later', '📁 Watch later']
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
  const meta = addon.meta(folders, 'slib:fav', ctx);
  assert.equal(meta.name, 'Favorites');
  assert.equal(meta.description, 'The best ones');
  assert.deepEqual(meta.links[0], {
    name: 'Open folder',
    category: 'S-library',
    url: `stremio:///discover/${encodeURIComponent(ctx.manifestUrl)}/folder/slib.fav`
  });
  assert.deepEqual(meta.links[1], { name: 'Edit folders', category: 'S-library', url: ctx.configureUrl });
  assert.deepEqual(meta.links.slice(2).map((l) => l.url), ['stremio:///detail/movie/tt0133093', 'stremio:///detail/series/kitsu%3A1']);
  assert.deepEqual(meta.videos.map((v) => v.id), ['slib:fav:movie:tt0133093', 'slib:fav:series:kitsu:1']);
  assert.equal(addon.meta(folders, 'slib:missing', ctx), null);
});

test('a folder video offers one stream that opens the title', () => {
  assert.deepEqual(addon.stream(folders, 'slib:fav:series:kitsu:1').streams, [
    { name: '📁 S-library', description: 'Open "Cowboy Bebop"', externalUrl: 'stremio:///detail/series/kitsu%3A1' }
  ]);
  assert.deepEqual(addon.stream(folders, 'slib:fav').streams, []);
  assert.deepEqual(addon.stream(folders, 'tt0133093').streams, []);
});
