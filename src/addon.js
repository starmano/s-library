// Stremio addon protocol responses (manifest, catalog, meta, stream), built from a user's folders.
'use strict';

const { ID_PREFIX, TYPE, colorOf, posterUrl, backgroundUrl } = require('./shared');
const { version } = require('../package.json');

const PAGE_SIZE = 100;
const ALL_FOLDERS_CATALOG = 'slib';
const FOLDER_CATALOG_PREFIX = 'slib.';
// Titles whose stream list gets S-library's "add to folder" entries.
const TITLE_TYPES = ['movie', 'series', 'anime'];

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
    description: 'Folders for your Stremio library, each with its own name, description, color and icon. Open any movie or show to add it to a folder from its list of streams.',
    logo: `${ctx.baseUrl}/img/logo.png`,
    background: backgroundUrl(ctx.baseUrl, 'purple'),
    types: [TYPE, ...TITLE_TYPES],
    resources: [
      'catalog',
      { name: 'meta', types: [TYPE], idPrefixes: [ID_PREFIX] },
      // Folder pages, and the folder entries in every title's stream list.
      { name: 'stream', types: [TYPE, ...TITLE_TYPES] }
    ],
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
    poster: posterUrl(ctx.baseUrl, folder.color, folder.name, folder.icon),
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
      { name: 'Edit this folder', category: 'S-library', url: `${ctx.configureUrl}#folder=${folder.id}` },
      { name: 'New folder', category: 'S-library', url: `${ctx.configureUrl}#new` },
      ...folder.items.map((item) => ({ name: item.name, category: 'In this folder', url: detailLink(item.type, item.id) }))
    ],
    // The folder's contents, listed where Stremio normally shows episodes.
    videos: folder.items.map((item) => ({ id: videoId(folder, item), title: item.name, thumbnail: itemThumbnail(item) }))
  };
}

// The title an episode belongs to: "tt0944947:1:1" -> "tt0944947", "kitsu:123:4" -> "kitsu:123".
function titleOf(id) {
  const imdb = /^tt\d+/.exec(id);
  if (imdb) return imdb[0];
  const parts = id.split(':');
  return parts.length > 2 ? parts.slice(0, 2).join(':') : id;
}

function actionUrl(ctx, action, folder, type, id) {
  return `${ctx.actionUrl}/${action}/${folder.id}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

// Stremio doesn't let addons add buttons, so S-library's actions live in stream lists. Picking
// one opens a short confirmation page (see server.js) that makes the change.
function stream(folders, type, id, ctx) {
  if (!id.startsWith(ID_PREFIX)) {
    // Any movie or show: add it to a folder, take it out, or start a new folder with it.
    const title = titleOf(id);
    const streams = folders.map((folder) => {
      const inside = folder.items.some((item) => item.id === title);
      return {
        name: `${colorOf(folder.color).emoji} ${folder.name}`,
        description: inside ? '✓ In this folder · tap to take it out' : '＋ Add to this folder',
        externalUrl: actionUrl(ctx, inside ? 'remove' : 'add', folder, type, title)
      };
    });
    streams.push({
      name: '📁 S-library',
      description: '＋ New folder with this title',
      externalUrl: `${ctx.configureUrl}#new=${encodeURIComponent(`${type}:${title}`)}`
    });
    return { streams };
  }

  const video = parseVideoId(id);
  const folder = folders.find((f) => f.id === (video ? video.folderId : id.slice(ID_PREFIX.length)));
  if (!video) {
    // An empty folder's page asks for the folder itself.
    return {
      streams: folder
        ? [{
            name: '📁 S-library',
            description: 'This folder is empty. Open a movie or show and pick this folder in its list of streams.',
            externalUrl: `${ctx.configureUrl}#folder=${folder.id}`
          }]
        : []
    };
  }
  // A title in a folder's list: jump to it, or take it out of the folder.
  const item = folder && folder.items.find((i) => i.id === video.itemId);
  const streams = [
    { name: '📁 S-library', description: `Open "${item ? item.name : video.itemId}"`, externalUrl: detailLink(video.type, video.itemId) }
  ];
  if (item) {
    streams.push({
      name: '📁 S-library',
      description: `✕ Take it out of "${folder.name}"`,
      externalUrl: actionUrl(ctx, 'remove', folder, video.type, video.itemId)
    });
  }
  return { streams };
}

module.exports = { manifest, catalog, meta, stream, parseVideoId, titleOf, PAGE_SIZE, TITLE_TYPES };
