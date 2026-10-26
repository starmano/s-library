// Stremio addon protocol responses (manifest, catalog, meta, stream), built from a user's folders.
//
// Stremio has no buttons or forms for addons, so folders are edited through what it does show:
// links on a folder's page, cards in search results and entries in stream lists. These lead to
// action ids ("slib:do:..."): opening one asks S-library for its page, which makes the change
// (see actions.js) and shows the result.
'use strict';

const crypto = require('node:crypto');
const { ID_PREFIX, TYPE, LIMITS, COLORS, colorOf, posterUrl, backgroundUrl } = require('./shared');
const { ICONS } = require('./images');
const { version } = require('../package.json');

const PAGE_SIZE = 100;
const ALL_FOLDERS_CATALOG = 'slib';
const SEARCH_CATALOG = 'slib.search';
const FOLDER_CATALOG_PREFIX = 'slib.';
const ACTION_PREFIX = `${ID_PREFIX}do:`;
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
        })),
        // Searching in Stremio finds folders and offers to create one.
        { type: TYPE, id: SEARCH_CATALOG, name: 'S-library', extra: [{ name: 'search', isRequired: true }] }
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

// A page inside Stremio: a folder, or an action.
function pageLink(id) {
  return detailLink(TYPE, id);
}

// Stremio's search page, with `text` already typed in.
function searchLink(text) {
  return `stremio:///search?search=${encodeURIComponent(text)}`;
}

function newFolderId() {
  return Array.from(crypto.randomBytes(8), (byte) => (byte % 36).toString(36)).join('');
}

// Action ids: "slib:do:<verb>:<folder id>:<version>[:<argument>]". Edits carry the version of the
// folder they were made for: Stremio reloads a page when you go back to it, and an action from
// an old page then just shows the folder instead of undoing newer changes.
function actionId(verb, folderId, folderVersion, arg) {
  return [`${ACTION_PREFIX}${verb}`, folderId || '-', folderVersion || 0].concat(arg === undefined ? [] : [arg]).join(':');
}

function parseAction(id) {
  if (!id.startsWith(ACTION_PREFIX)) return null;
  const [verb, folderId, folderVersion, ...rest] = id.slice(ACTION_PREFIX.length).split(':');
  return { verb, folderId, version: Number(folderVersion) || 0, arg: rest.join(':') };
}

// Free text (names, descriptions) inside ids.
function encodeText(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function decodeText(value) {
  return Buffer.from(value || '', 'base64url').toString('utf8');
}

// "<type>:<title id>" (title ids may contain ":").
function splitTitle(arg) {
  const split = arg.indexOf(':');
  return split > 0 ? { type: arg.slice(0, split), id: arg.slice(split + 1) } : null;
}

function link(category, name, url) {
  return { name, category, url };
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

// Search: "new folder: <name>", "rename <folder>: <name>" and "describe <folder>: <text>" give a
// card that does it; anything else finds folders by name and offers a new folder with that name.
function search(folders, query, ctx) {
  const text = query.trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const card = (id, name, description, poster) => ({ id, type: TYPE, name, description, poster, posterShape: 'poster' });
  const hint = (topic, name, description) => card(actionId('help', '-', 0, topic), name, description, posterUrl(ctx.baseUrl, null, '?'));
  const create = (name) => card(
    actionId('new', newFolderId(), 0, encodeText(name)),
    `＋ New folder "${name}"`,
    'Open to create this folder. Then add movies and shows to it from their list of streams.',
    posterUrl(ctx.baseUrl, null, name)
  );

  for (const verb of ['rename', 'describe']) {
    if (!lower.startsWith(`${verb} `)) continue;
    // Longest names first, so "Action" doesn't match a search meant for "Action classics".
    const folder = folders
      .slice()
      .sort((a, b) => b.name.length - a.name.length)
      .find((f) => lower.startsWith(`${verb} ${f.name.toLowerCase()}:`));
    if (!folder) {
      return [hint(verb, 'No folder by that name', `Type "${verb} <folder name>: …", e.g. "${verb} Favorites: …".`)];
    }
    const value = text.slice(verb.length + folder.name.length + 2).trim();
    if (verb === 'rename') {
      if (!value) return [hint('rename', 'Type the new name', `Type the new name after "rename ${folder.name}:".`)];
      const name = value.slice(0, LIMITS.name);
      return [card(
        actionId('rename', folder.id, folder.version, encodeText(name)),
        `Rename to "${name}"`,
        `Open to rename "${folder.name}" to "${name}".`,
        posterUrl(ctx.baseUrl, folder.color, name, folder.icon)
      )];
    }
    if (!value) return [hint('describe', 'Type the description', `Type the description after "describe ${folder.name}:".`)];
    return [card(
      actionId('describe', folder.id, folder.version, encodeText(value.slice(0, LIMITS.description))),
      `Set the description of "${folder.name}"`,
      `Open to save this description: ${value}`,
      posterUrl(ctx.baseUrl, folder.color, folder.name, folder.icon)
    )];
  }

  const newFolder = /^new folder(?::|\s|$)\s*(.*)$/i.exec(text);
  if (newFolder) {
    const name = newFolder[1].slice(0, LIMITS.name);
    return [name ? create(name) : hint('new', 'Type the folder name', 'Type the name after "new folder:".')];
  }
  if (!text) return [];
  const matches = folders.filter((folder) => folder.name.toLowerCase().includes(lower)).map((folder) => folderPreview(folder, ctx));
  return matches.concat(create(text.slice(0, LIMITS.name)));
}

function catalog(folders, id, extra, ctx) {
  let metas = [];
  if (id === ALL_FOLDERS_CATALOG) {
    metas = folders.map((folder) => folderPreview(folder, ctx));
  } else if (id === SEARCH_CATALOG) {
    metas = search(folders, extra.search || '', ctx);
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
  if (id.startsWith(ACTION_PREFIX)) return null;
  const [prefix, folderId, type, ...rest] = id.split(':');
  if (`${prefix}:` !== ID_PREFIX || !folderId || !type || rest.length === 0) return null;
  return { folderId, type, itemId: rest.join(':') };
}

// Links shared by every S-library page.
function generalLinks(settings, ctx, configureUrl) {
  return [
    link('S-library', 'New folder', searchLink('new folder: ')),
    link(
      'S-library',
      settings.library ? 'Hide folders from my Library' : 'Show folders in my Library',
      pageLink(actionId('library', '-', settings.version, settings.library ? 'off' : 'on'))
    ),
    link('S-library', 'Edit on the web', configureUrl || ctx.configureUrl)
  ];
}

// A folder's page: what's in it, and links to change it.
function folderMeta(folder, { folders, settings }, ctx) {
  const index = folders.findIndex((f) => f.id === folder.id);
  const edit = (verb, arg) => pageLink(actionId(verb, folder.id, folder.version, arg));
  const color = folder.color || 'none';
  return {
    ...folderPreview(folder, ctx),
    links: [
      link('Folder', 'Open as a grid', `stremio:///discover/${encodeURIComponent(ctx.manifestUrl)}/${TYPE}/${FOLDER_CATALOG_PREFIX}${folder.id}`),
      link('Folder', 'Rename', searchLink(`rename ${folder.name}: `)),
      link('Folder', 'Description', searchLink(`describe ${folder.name}: `)),
      ...(index > 0 ? [link('Folder', 'Move up', edit('up'))] : []),
      ...(index >= 0 && index < folders.length - 1 ? [link('Folder', 'Move down', edit('down'))] : []),
      link('Folder', 'Delete', edit('delete')),
      ...[...Object.keys(COLORS), 'none'].map((key) => {
        const { emoji, label } = colorOf(key);
        return link('Color', `${key === color ? '✓ ' : ''}${emoji} ${label}`, edit('color', key));
      }),
      ...Object.entries(ICONS).map(([key, icon]) => link('Icon', `${key === folder.icon ? '✓ ' : ''}${icon.label}`, edit('icon', key))),
      ...folder.items.map((item) => link('In this folder', item.name, detailLink(item.type, item.id))),
      ...generalLinks(settings, ctx, `${ctx.configureUrl}#folder=${folder.id}`)
    ],
    // The folder's contents, listed where Stremio normally shows episodes.
    videos: folder.items.map((item) => ({ id: videoId(folder, item), title: item.name, thumbnail: itemThumbnail(item) }))
  };
}

function meta(library, id, ctx) {
  const folder = library.folders.find((f) => ID_PREFIX + f.id === id);
  return folder ? folderMeta(folder, library, ctx) : null;
}

// S-library's own page: the folders, and what can be done from here.
function overviewMeta(id, { folders, settings }, message, ctx) {
  return {
    id,
    type: TYPE,
    name: 'S-library',
    poster: `${ctx.baseUrl}/img/logo.png`,
    posterShape: 'square',
    background: backgroundUrl(ctx.baseUrl, 'purple'),
    description: message,
    links: [
      ...folders.map((folder) => link('Your folders', `${colorOf(folder.color).emoji} ${folder.name}`, pageLink(ID_PREFIX + folder.id))),
      ...generalLinks(settings, ctx)
    ]
  };
}

// The page an action id opens, given what the action did (see actions.js).
function actionMeta(id, outcome, ctx) {
  const { page, folder, library, message, title } = outcome;
  if (page === 'confirm-delete') {
    return {
      ...folderPreview(folder, ctx),
      id,
      name: `Delete "${folder.name}"?`,
      description: 'Only the folder is deleted. The movies and shows in it stay where they are in Stremio.',
      links: [
        link('Delete this folder?', `Yes, delete "${folder.name}"`, pageLink(actionId('delete-now', folder.id, folder.version))),
        link('Delete this folder?', 'No, keep it', pageLink(ID_PREFIX + folder.id))
      ]
    };
  }
  if (page === 'folder') {
    const view = folderMeta(folder, library, ctx);
    if (title) view.links.unshift(link('Folder', `Back to "${title.name}"`, detailLink(title.type, title.id)));
    return { ...view, id, description: [message, folder.description].filter(Boolean).join('\n\n') };
  }
  return overviewMeta(id, library, message, ctx);
}

// The title an episode belongs to: "tt0944947:1:1" -> "tt0944947", "kitsu:123:4" -> "kitsu:123".
function titleOf(id) {
  const imdb = /^tt\d+/.exec(id);
  if (imdb) return imdb[0];
  const parts = id.split(':');
  return parts.length > 2 ? parts.slice(0, 2).join(':') : id;
}

// Where a stream-list action leads. The Stremio apps open "stremio:" links inside themselves, so
// they get the in-app page; Stremio Web would open them in a new tab, so it gets a web page.
function actionLink(ctx, verb, folderId, type, id) {
  if (ctx.native) return pageLink(actionId(verb, folderId, 0, `${type}:${id}`));
  return `${ctx.actionUrl}/${verb}/${folderId}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

function stream(folders, type, id, ctx) {
  if (!id.startsWith(ID_PREFIX)) {
    // Any movie or show: add it to a folder, take it out, or start a new folder with it.
    const title = titleOf(id);
    const streams = folders.map((folder) => {
      const inside = folder.items.some((item) => item.id === title);
      return {
        name: `${colorOf(folder.color).emoji} ${folder.name}`,
        description: inside ? '✓ In this folder · tap to take it out' : '＋ Add to this folder',
        externalUrl: actionLink(ctx, inside ? 'remove' : 'add', folder.id, type, title)
      };
    });
    streams.push({
      name: '📁 S-library',
      description: '＋ New folder with this title',
      externalUrl: ctx.native
        ? pageLink(actionId('new-with', newFolderId(), 0, `${type}:${title}`))
        : `${ctx.configureUrl}#new=${encodeURIComponent(`${type}:${title}`)}`
    });
    return { streams };
  }

  const action = parseAction(id);
  const video = parseVideoId(id);
  const folderId = action ? action.folderId : video ? video.folderId : id.slice(ID_PREFIX.length);
  const folder = folders.find((f) => f.id === folderId);
  if (!video) {
    // Stremio asks a page without a list of titles for its streams: say what to do instead.
    if (!folder) return { streams: [] };
    return {
      streams: [{
        name: '📁 S-library',
        description: folder.items.length
          ? 'Pick a title in this folder, or use the links on the left.'
          : 'This folder is empty. Open a movie or show and pick this folder in its list of streams.',
        externalUrl: ctx.native ? searchLink('') : `${ctx.configureUrl}#folder=${folder.id}`
      }]
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
      externalUrl: actionLink(ctx, 'remove', folder.id, video.type, video.itemId)
    });
  }
  return { streams };
}

module.exports = {
  manifest,
  catalog,
  meta,
  actionMeta,
  stream,
  parseAction,
  parseVideoId,
  splitTitle,
  decodeText,
  titleOf,
  PAGE_SIZE,
  TITLE_TYPES
};
