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
const settings = { library: true, discover: true, search: true, version: 0 };
const library = { folders, settings };

test('unconfigured manifest asks to be configured', () => {
  const manifest = addon.manifest(null, ctx);
  assert.equal(manifest.name, 'S-library');
  assert.deepEqual(manifest.catalogs, []);
  assert.deepEqual(manifest.behaviorHints, { configurable: true, configurationRequired: true });
});

test('configured manifest has one catalog per folder, marked with its color', () => {
  const manifest = addon.manifest(library, ctx);
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

test('folders can be left out of Discover (and the Board) and out of search', () => {
  const off = { folders, settings: { ...settings, discover: false, search: false } };
  assert.deepEqual(addon.manifest(off, ctx).catalogs.map((c) => c.id), ['slib.search'], 'search commands keep working');
  assert.ok(!addon.meta(off, 'slib:fav', ctx).links.some((l) => l.name === '🖼️ Show as posters'));
  assert.deepEqual(addon.catalog(off, 'slib.search', { search: 'fav' }, ctx).metas, []);
  assert.match(addon.catalog(off, 'slib.search', { search: 'new folder: Road trip' }, ctx).metas[0].id, /^slib:do:new:/);
  assert.match(addon.catalog(off, 'slib.search', { search: 'rename Favorites: Best' }, ctx).metas[0].id, /^slib:do:rename:fav:5:/);
  const on = addon.catalog(library, 'slib.search', { search: 'fav' }, ctx).metas;
  assert.deepEqual(on.map((m) => m.id.split(':').slice(0, 3).join(':')), ['slib:fav', 'slib:do:new']);
});

test('posters can leave out the name or the icon', () => {
  const plain = { ...folders[0], showName: false, icon: 'none' };
  const [meta] = addon.catalog({ folders: [plain], settings }, 'slib', {}, ctx).metas;
  assert.equal(meta.name, 'Favorites');
  assert.equal(meta.poster, 'https://addon.test/img/poster/red.png?icon=none');
  const icons = addon.meta({ folders: [plain], settings }, 'slib:fav', ctx).links.filter((l) => l.category === 'Icon');
  assert.equal(icons[0].name, '✓ No icon');
  assert.ok(icons.length > 90);
});

test('Samsung and LG TVs get folder pages with the titles as a list, and TV links', () => {
  const tv = { ...ctx, native: true, tv: true };
  const meta = addon.meta(library, 'slib:fav', tv);
  assert.equal(meta.behaviorHints, undefined, 'no default video: the TV shows the list of titles');
  assert.deepEqual(meta.videos, [
    { id: 'slib:fav:movie:tt0133093', title: 'The Matrix', thumbnail: 'https://images.metahub.space/background/medium/tt0133093/img' },
    { id: 'slib:fav:series:kitsu:1', title: 'Cowboy Bebop', thumbnail: 'https://example.com/bebop.jpg' }
  ]);
  assert.equal(addon.catalog(library, 'slib', {}, tv).metas[0].behaviorHints, undefined);
  // A title in that list opens it, with the link in the TV fields too.
  assert.deepEqual(addon.stream(library, 'folder', 'slib:fav:movie:tt0133093', tv).streams, [{
    name: '🎬 Open',
    description: 'Open "The Matrix"',
    thumbnail: 'https://images.metahub.space/poster/medium/tt0133093/img',
    externalUrl: 'stremio:///detail/movie/tt0133093',
    androidTvUrl: 'stremio:///detail/movie/tt0133093',
    tizenUrl: 'stremio:///detail/movie/tt0133093',
    webosUrl: 'stremio:///detail/movie/tt0133093'
  }]);
  // Elsewhere, folder pages have no videos.
  assert.equal(addon.meta(library, 'slib:fav', ctx).videos, undefined);
});

test('every S-library page opens on its own stream list, also in older Stremio apps', () => {
  // Older apps (e.g. on Samsung TVs) don't guess it, and wait for an episode list otherwise.
  assert.equal(addon.meta(library, 'slib:fav', ctx).behaviorHints.defaultVideoId, 'slib:fav');
  const card = addon.catalog(library, 'slib.search', { search: 'new folder: Road trip' }, ctx).metas[0];
  assert.equal(card.behaviorHints.defaultVideoId, card.id);
  const id = 'slib:do:color:fav:5:red';
  const page = addon.actionMeta(id, { page: 'folder', folder: folders[0], library, message: '✓' }, ctx);
  assert.equal(page.behaviorHints.defaultVideoId, id);
  assert.equal(addon.actionMeta('slib:do:help:-:0:new', { page: 'overview', library, message: '' }, ctx).behaviorHints.defaultVideoId, 'slib:do:help:-:0:new');
});

test('the S-library catalog lists the folders themselves', () => {
  const { metas } = addon.catalog(library, 'slib', {}, ctx);
  assert.equal(metas.length, 2);
  assert.deepEqual(metas[0], {
    id: 'slib:fav',
    type: 'folder',
    name: 'Favorites',
    poster: 'https://addon.test/img/poster/red.png?name=Favorites',
    posterShape: 'poster',
    background: 'https://addon.test/img/bg/red.png',
    description: 'The best ones',
    releaseInfo: '2 titles',
    behaviorHints: { defaultVideoId: 'slib:fav' }
  });
  assert.equal(metas[1].releaseInfo, '0 titles');
});

test('a folder catalog lists its titles, with pagination', () => {
  const { metas } = addon.catalog(library, 'slib.fav', {}, ctx);
  assert.deepEqual(metas, [
    { id: 'tt0133093', type: 'movie', name: 'The Matrix', poster: 'https://images.metahub.space/poster/medium/tt0133093/img' },
    { id: 'kitsu:1', type: 'series', name: 'Cowboy Bebop', poster: 'https://example.com/bebop.jpg' }
  ]);
  const big = { folders: [{ ...folders[0], items: Array.from({ length: 150 }, (_, i) => ({ id: `tt${i}`, type: 'movie', name: `#${i}` })) }], settings };
  assert.equal(addon.catalog(big, 'slib.fav', {}, ctx).metas.length, addon.PAGE_SIZE);
  assert.equal(addon.catalog(big, 'slib.fav', { skip: '100' }, ctx).metas[0].name, '#100');
  assert.deepEqual(addon.catalog(library, 'slib.missing', {}, ctx).metas, []);
});

test('folder meta has description and links to its titles', () => {
  const meta = addon.meta(library, 'slib:fav', ctx);
  assert.equal(meta.name, 'Favorites');
  assert.equal(meta.description, 'The best ones');
  assert.deepEqual(meta.links[0], {
    name: '🖼️ Show as posters',
    category: 'Folder',
    url: `stremio:///discover/${encodeURIComponent(ctx.manifestUrl)}/folder/slib.fav`
  });
  const titles = meta.links.filter((l) => l.category === 'In this folder');
  assert.deepEqual(titles.map((l) => l.url), ['stremio:///detail/movie/tt0133093', 'stremio:///detail/series/kitsu%3A1']);
  assert.ok(meta.links.some((l) => l.name === 'Edit on the web' && l.url === `${ctx.configureUrl}#folder=fav`));
  assert.equal(meta.videos, undefined, 'no episode-style list: Stremio shows the stream list, which has the titles');
  assert.equal(addon.meta(library, 'slib:missing', ctx), null);
});

test("a title's stream list offers every folder, and a new one", () => {
  assert.deepEqual(addon.stream(library, 'movie', 'tt0133093', ctx).streams, [
    { name: '🔴 Favorites', description: '✓ Already in this folder', externalUrl: 'https://addon.test/cfg/act/add/fav/movie/tt0133093' },
    { name: '📁 Watch later', description: '＋ Tap to add it to this folder', externalUrl: 'https://addon.test/cfg/act/add/later/movie/tt0133093' },
    { name: '📁 New folder', description: '＋ Tap to create a new folder with this title in it', externalUrl: 'https://addon.test/cfg/configure#new=movie%3Att0133093' }
  ]);
  // Episodes act on their show.
  const episode = addon.stream(library, 'series', 'kitsu:1:5', ctx).streams;
  assert.equal(episode[0].externalUrl, 'https://addon.test/cfg/act/add/fav/series/kitsu%3A1');
  assert.equal(addon.stream({ folders: [], settings }, 'series', 'tt0944947:1:1', ctx).streams[0].externalUrl, 'https://addon.test/cfg/configure#new=series%3Att0944947');
});

test("a folder's page leads to its poster grid, then lists its titles", () => {
  const native = { ...ctx, native: true };
  const grid = `discover/${encodeURIComponent(ctx.manifestUrl)}/folder/slib.fav`;
  const titles = [
    { name: 'The Matrix', description: 'Movie · tap to open', thumbnail: 'https://images.metahub.space/poster/medium/tt0133093/img', externalUrl: 'stremio:///detail/movie/tt0133093', androidTvUrl: 'stremio:///detail/movie/tt0133093' },
    { name: 'Cowboy Bebop', description: 'Series · tap to open', thumbnail: 'https://example.com/bebop.jpg', externalUrl: 'stremio:///detail/series/kitsu%3A1', androidTvUrl: 'stremio:///detail/series/kitsu%3A1' }
  ];
  assert.deepEqual(addon.stream(library, 'folder', 'slib:fav', native).streams, [{
    name: '🖼️ Show as posters',
    description: 'Open the 2 titles in "Favorites" as posters.\nTap one to open it; back brings you to the posters again.',
    externalUrl: `stremio:///${grid}`,
    androidTvUrl: `stremio:///${grid}`
  }, ...titles]);
  // Stremio Web opens stream entries in a new tab, so it gets Stremio Web's address.
  assert.equal(addon.stream(library, 'folder', 'slib:fav', ctx).streams[0].externalUrl, `https://web.stremio.com/#/${grid}`);
  // The same on a page an edit opens.
  assert.equal(addon.stream(library, 'folder', 'slib:do:color:fav:5:red', native).streams[0].name, '🖼️ Show as posters');

  // Without the grid (folders left out of Discover), just the titles.
  const noGrid = { folders, settings: { ...settings, discover: false } };
  assert.deepEqual(addon.stream(noGrid, 'folder', 'slib:fav', native).streams, titles);
  assert.equal(addon.stream(noGrid, 'folder', 'slib:fav', ctx).streams[0].externalUrl, 'https://web.stremio.com/#/detail/movie/tt0133093');

  // Links from folder pages of earlier versions still open the title.
  assert.equal(addon.stream(library, 'folder', 'slib:fav:series:kitsu:1', native).streams[0].externalUrl, 'stremio:///detail/series/kitsu%3A1');
  // An empty folder's page explains how to fill it.
  assert.match(addon.stream(library, 'folder', 'slib:later', ctx).streams[0].description, /folder is empty/);
  // Stremio Web gets web links, without TV fields.
  assert.equal(addon.stream(library, 'folder', 'slib:fav', ctx).streams[0].androidTvUrl, undefined);
  assert.deepEqual(addon.stream(library, 'folder', 'slib:missing', ctx).streams, []);
});

test('episode ids map to their show', () => {
  assert.equal(addon.titleOf('tt0944947:1:1'), 'tt0944947');
  assert.equal(addon.titleOf('tt0133093'), 'tt0133093');
  assert.equal(addon.titleOf('kitsu:123:4'), 'kitsu:123');
  assert.equal(addon.titleOf('kitsu:123'), 'kitsu:123');
});
