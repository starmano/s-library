// Stremio addon protocol responses (manifest, catalog, meta, stream), built from a user's folders.
'use strict';

const { ID_PREFIX, TYPE, colorOf, posterUrl, backgroundUrl } = require('./shared');
const { version } = require('../package.json');

const PAGE_SIZE = 100;
const ALL_FOLDERS_CATALOG = 'slib';
const FOLDER_CATALOG_PREFIX = 'slib.';

// `folders` is null when the addon has not been configured yet.
function manifest(folders, ctx) {
  const catalogs = folders
    ? [
        { type: TYPE, id: ALL_FOLDERS_CATALOG, name: '📁 S-library', extra: [{ name: 'skip' }] },
        ...folders.map((folder) => ({
          type: TYPE,
          id: FOLDER_CATALOG_PREFIX + folder.id,
          name: `${colorOf(folder.color).emoji} ${folder.name}`,
          extra: [{ name: 'skip' }]
        }))
      ]
    : [];
  return {
    id: 'community.slibrary',
    version,
    name: 'S-library',
    description: 'Create folders in your Stremio library, each with its own name, description and color.',
    logo: `${ctx.baseUrl}/img/logo.png`,
    background: backgroundUrl(ctx.baseUrl, 'purple'),
    types: [TYPE],
    idPrefixes: [ID_PREFIX],
    resources: ['catalog', 'meta', 'stream'],
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: !folders }
  };
}

function itemPoster(item) {
  if (item.poster) return item.poster;
  return /^tt\d+$/.test(item.id) ? `https://images.metahub.space/poster/medium/${item.id}/img` : undefined;
}

function itemThumbnail(item) {
  return /^tt\d+$/.test(item.id) ? `https://images.metahub.space/background/medium/${item.id}/img` : itemPoster(item);
}

function detailLink(type, id) {
  return `stremio:///detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

function folderPreview(folder, ctx) {
  const count = folder.items.length;
  return {
    id: ID_PREFIX + folder.id,
    type: TYPE,
    name: folder.name,
    poster: posterUrl(ctx.baseUrl, folder.color),
    posterShape: 'poster',
    background: backgroundUrl(ctx.baseUrl, folder.color),
    description: folder.description,
    releaseInfo: count === 1 ? '1 title' : `${count} titles`
  };
}

function catalog(folders, id, extra, ctx) {
  let metas = [];
  if (id === ALL_FOLDERS_CATALOG) {
    metas = folders.map((folder) => folderPreview(folder, ctx));
  } else if (id.startsWith(FOLDER_CATALOG_PREFIX)) {
    const folder = folders.find((f) => f.id === id.slice(FOLDER_CATALOG_PREFIX.length));
    if (folder) {
      metas = folder.items.map((item) => ({ id: item.id, type: item.type, name: item.name, poster: itemPoster(item) }));
    }
  }
  const skip = Math.max(0, parseInt(extra.skip, 10) || 0);
  return { metas: metas.slice(skip, skip + PAGE_SIZE) };
}

// Video ids look like "slib:<folder id>:<type>:<title id>"; title ids may contain ":" themselves.
function videoId(folder, item) {
  return `${ID_PREFIX}${folder.id}:${item.type}:${item.id}`;
}

function parseVideoId(id) {
  const [prefix, folderId, type, ...rest] = id.split(':');
  if (`${prefix}:` !== ID_PREFIX || !folderId || !type || rest.length === 0) return null;
  return { folderId, type, itemId: rest.join(':') };
}

function meta(folders, id, ctx) {
  const folder = folders.find((f) => ID_PREFIX + f.id === id);
  if (!folder) return null;
  return {
    ...folderPreview(folder, ctx),
    links: [
      {
        name: 'Open folder',
        category: 'S-library',
        url: `stremio:///discover/${encodeURIComponent(ctx.manifestUrl)}/${TYPE}/${FOLDER_CATALOG_PREFIX}${folder.id}`
      },
      { name: 'Edit folders', category: 'S-library', url: ctx.configureUrl },
      ...folder.items.map((item) => ({ name: item.name, category: 'In this folder', url: detailLink(item.type, item.id) }))
    ],
    // The folder's contents, listed where Stremio normally shows episodes.
    videos: folder.items.map((item) => ({ id: videoId(folder, item), title: item.name, thumbnail: itemThumbnail(item) }))
  };
}

// Selecting a title in a folder's list offers a single "stream" that jumps to that title.
function stream(folders, id) {
  const video = parseVideoId(id);
  if (!video) return { streams: [] };
  const folder = folders.find((f) => f.id === video.folderId);
  const item = folder && folder.items.find((i) => i.id === video.itemId);
  return {
    streams: [
      {
        name: '📁 S-library',
        description: `Open "${item ? item.name : video.itemId}"`,
        externalUrl: detailLink(video.type, video.itemId)
      }
    ]
  };
}

module.exports = { manifest, catalog, meta, stream, parseVideoId, PAGE_SIZE };
