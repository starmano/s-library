// Stremio addon protocol responses (manifest, catalog, meta, stream), built from a user's folders.
//
// Stremio has no buttons or forms for addons, so folders are edited through what it does show:
// links on a folder's page, cards in search results and entries in stream lists. These lead to
// action ids ("slib:do:..."): opening one asks S-library for its page, which makes the change
// (see actions.js) and shows the result.
'use strict';

const crypto = require('node:crypto');
const { ID_PREFIX, TYPE, LIMITS, COLORS, NO_ICON, colorOf, posterUrl, folderPoster, backgroundUrl } = require('./shared');
const { ICONS } = require('./images');
const { version } = require('../package.json');

const PAGE_SIZE = 100;
const ALL_FOLDERS_CATALOG = 'slib';
const SEARCH_CATALOG = 'slib.search';
const FOLDER_CATALOG_PREFIX = 'slib.';
const ACTION_PREFIX = `${ID_PREFIX}do:`;
// Titles whose stream list gets S-library's "add to folder" entries.
const TITLE_TYPES = ['movie', 'series', 'anime'];
const TYPE_LABELS = { movie: 'Movie', series: 'Series', anime: 'Anime', channel: 'Channel', tv: 'TV' };

// `library` ({ folders, settings }) is null when the addon has not been configured yet.
function manifest(library, ctx) {
  const rows = library && library.settings.discover
    ? [
        { type: TYPE, id: ALL_FOLDERS_CATALOG, name: '📁 S-library', extra: [{ name: 'skip' }] },
        ...library.folders.map((folder) => ({
          type: TYPE,
          id: FOLDER_CATALOG_PREFIX + folder.id,
          name: `${colorOf(folder.color).emoji} ${folder.name}`,
          extra: [{ name: 'skip' }]
        }))
      ]
    : [];
  const catalogs = library
    ? [
        // The Board and Discover show these rows.
        ...rows,
        // Searching in Stremio finds folders and offers to create one. It also does the "new
        // folder:", "rename" and "describe" searches, so it stays when folders are left out of search.
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
    behaviorHints: { configurable: true, configurationRequired: !library }
  };
}

function itemPoster(item) {
  if (item.poster) return item.poster;
  return /^tt\d+$/.test(item.id) ? `https://images.metahub.space/poster/medium/${item.id}/img` : undefined;
}


function detailLink(type, id) {
  return `stremio:///detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

// A page in Stremio, from a stream-list entry. Stremio Web opens those in a new tab, where a
// "stremio:" link does nothing, so it gets the page on Stremio Web instead.
function streamLink(ctx, path) {
  return ctx.native ? `stremio:///${path}` : `https://web.stremio.com/#/${path}`;
}

function openLink(ctx, type, id) {
  return streamLink(ctx, `detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
}

// A folder as a poster grid: its row in Discover. Titles opened there go back to the grid.
function gridPath(folder, ctx) {
  return `discover/${encodeURIComponent(ctx.manifestUrl)}/${TYPE}/${FOLDER_CATALOG_PREFIX}${folder.id}`;
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

// S-library's pages have no episode list: they open on their own stream list. Stremio reads
// that from defaultVideoId (Cinemeta sets it on every movie), or guesses it.
function opensStreams(meta) {
  return { ...meta, behaviorHints: { ...meta.behaviorHints, defaultVideoId: meta.id } };
}

// Stremio on Samsung and LG TVs shows a folder's stream list as loading forever: its entries
// only link to other pages, which those apps seem to leave out. So TVs get folder pages with
// the titles as an episode-style list instead, which they show (see folderMeta).
function folderPreview(folder, ctx) {
  const count = folder.items.length;
  return (ctx.tv ? (meta) => meta : opensStreams)({
    id: ID_PREFIX + folder.id,
    type: TYPE,
    name: folder.name,
    poster: folderPoster(ctx.baseUrl, folder),
    posterShape: 'poster',
    background: backgroundUrl(ctx.baseUrl, folder.color),
    description: folder.description,
    releaseInfo: count === 1 ? '1 title' : `${count} titles`
  });
}

// Search: "new folder: <name>", "rename <folder>: <name>" and "describe <folder>: <text>" give a
// card that does it; anything else finds folders by name and offers a new folder with that name,
// unless folders are left out of search.
function search({ folders, settings }, query, ctx) {
  const text = query.trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const card = (id, name, description, poster) => opensStreams({ id, type: TYPE, name, description, poster, posterShape: 'poster' });
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
        folderPoster(ctx.baseUrl, { ...folder, name })
      )];
    }
    if (!value) return [hint('describe', 'Type the description', `Type the description after "describe ${folder.name}:".`)];
    return [card(
      actionId('describe', folder.id, folder.version, encodeText(value.slice(0, LIMITS.description))),
      `Set the description of "${folder.name}"`,
      `Open to save this description: ${value}`,
      folderPoster(ctx.baseUrl, folder)
    )];
  }

  const newFolder = /^new folder(?::|\s|$)\s*(.*)$/i.exec(text);
  if (newFolder) {
    const name = newFolder[1].slice(0, LIMITS.name);
    return [name ? create(name) : hint('new', 'Type the folder name', 'Type the name after "new folder:".')];
  }
  if (!text || !settings.search) return [];
  const matches = folders.filter((folder) => folder.name.toLowerCase().includes(lower)).map((folder) => folderPreview(folder, ctx));
  return matches.concat(create(text.slice(0, LIMITS.name)));
}

function catalog(library, id, extra, ctx) {
  const { folders } = library;
  let metas = [];
  if (id === ALL_FOLDERS_CATALOG) {
    metas = folders.map((folder) => folderPreview(folder, ctx));
  } else if (id === SEARCH_CATALOG) {
    metas = search(library, extra.search || '', ctx);
  } else if (id.startsWith(FOLDER_CATALOG_PREFIX)) {
    const folder = folders.find((f) => f.id === id.slice(FOLDER_CATALOG_PREFIX.length));
    if (folder) {
      metas = folder.items.map((item) => ({ id: item.id, type: item.type, name: item.name, poster: itemPoster(item) }));
    }
  }
  const skip = Math.max(0, parseInt(extra.skip, 10) || 0);
  return { metas: metas.slice(skip, skip + PAGE_SIZE) };
}

// Titles as videos (folder pages on TVs, and everywhere up to version 1.7) have ids like
// "slib:<folder id>:<type>:<title id>" (title ids may contain ":" themselves).
function videoId(folder, item) {
  return `${ID_PREFIX}${folder.id}:${item.type}:${item.id}`;
}

function itemThumbnail(item) {
  return /^tt\d+$/.test(item.id) ? `https://images.metahub.space/background/medium/${item.id}/img` : itemPoster(item);
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
      ...(settings.discover ? [link('Folder', '🖼️ Show as posters', `stremio:///${gridPath(folder, ctx)}`)] : []),
      link('Folder', 'Rename', searchLink(`rename ${folder.name}: `)),
      link('Folder', 'Description', searchLink(`describe ${folder.name}: `)),
      ...(index > 0 ? [link('Folder', 'Move up', edit('up'))] : []),
      ...(index >= 0 && index < folders.length - 1 ? [link('Folder', 'Move down', edit('down'))] : []),
      link('Folder', 'Delete', edit('delete')),
      ...[...Object.keys(COLORS), 'none'].map((key) => {
        const { emoji, label } = colorOf(key);
        return link('Color', `${key === color ? '✓ ' : ''}${emoji} ${label}`, edit('color', key));
      }),
      ...[[NO_ICON, { label: 'No icon' }], ...Object.entries(ICONS)].map(([key, icon]) =>
        link('Icon', `${key === folder.icon ? '✓ ' : ''}${icon.label}`, edit('icon', key))),
      ...folder.items.map((item) => link('In this folder', item.name, detailLink(item.type, item.id))),
      ...generalLinks(settings, ctx, `${ctx.configureUrl}#folder=${folder.id}`)
    ],
    // Elsewhere no videos: Stremio then shows the page's stream list right away, which leads to
    // the folder's poster grid (see stream). TVs get the titles as videos.
    ...(ctx.tv ? { videos: folder.items.map((item) => ({ id: videoId(folder, item), title: item.name, thumbnail: itemThumbnail(item) })) } : {})
  };
}

function meta(library, id, ctx) {
  const folder = library.folders.find((f) => ID_PREFIX + f.id === id);
  return folder ? folderMeta(folder, library, ctx) : null;
}

// S-library's own page: the folders, and what can be done from here.
function overviewMeta(id, { folders, settings }, message, ctx) {
  return opensStreams({
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
  });
}

// The page an action id opens, given what the action did (see actions.js).
function actionMeta(id, outcome, ctx) {
  return opensStreams(actionPage(id, outcome, ctx));
}

function actionPage(id, outcome, ctx) {
  const { page, folder, library, message, title } = outcome;
  if (page === 'added') {
    // A short page that says it's done; back returns to the title.
    return {
      ...folderPreview(folder, ctx),
      id,
      name: outcome.already ? `Already in "${folder.name}"` : `✓ Added to "${folder.name}"`,
      poster: itemPoster(title) || folderPoster(ctx.baseUrl, folder),
      description: `${message} Press back to return to it.`,
      links: [
        link('Done', `Back to "${title.name}"`, detailLink(title.type, title.id)),
        link('Done', `Open "${folder.name}"`, pageLink(ID_PREFIX + folder.id)),
        link('Done', 'Wrong folder? Fix it on the web', `${ctx.configureUrl}#folder=${folder.id}`)
      ]
    };
  }
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

// Stremio's TV apps read their own link fields on stream-list entries; they get the same link.
function withTvLinks({ streams }, ctx) {
  return {
    streams: streams.map((entry) => {
      if (!entry.externalUrl || !entry.externalUrl.startsWith('stremio:')) return entry;
      const url = entry.externalUrl;
      return { ...entry, androidTvUrl: url, ...(ctx.tv ? { tizenUrl: url, webosUrl: url } : {}) };
    })
  };
}

function stream(library, type, id, ctx) {
  return withTvLinks(streamList(library, type, id, ctx), ctx);
}

function streamList({ folders, settings }, type, id, ctx) {
  if (!id.startsWith(ID_PREFIX)) {
    if (!TITLE_TYPES.includes(type)) return { streams: [] };
    // Any movie or show: one tap adds it to a folder, or starts a new folder with it.
    const title = titleOf(id);
    const streams = folders.map((folder) => ({
      name: `${colorOf(folder.color).emoji} ${folder.name}`,
      description: folder.items.some((item) => item.id === title) ? '✓ Already in this folder' : '＋ Tap to add it to this folder',
      externalUrl: actionLink(ctx, 'add', folder.id, type, title)
    }));
    streams.push({
      name: '📁 New folder',
      description: '＋ Tap to create a new folder with this title in it',
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
    if (!folder) return { streams: [] };
    if (action && action.verb === 'add') {
      // The page after adding a title: back to it.
      const ref = splitTitle(action.arg);
      const item = ref && folder.items.find((i) => i.id === ref.id);
      if (!item) return { streams: [] };
      return { streams: [{ name: '◀ Back', description: `Back to "${item.name}"`, externalUrl: openLink(ctx, item.type, item.id) }] };
    }
    // A folder's page (or an edit that shows it): its poster grid first, then its titles, one
    // tap each. Stremio forgets the way back when it opens a stream-list link, and the Android
    // app shows no pictures there; the grid has both. It's the folder's row in Discover, so
    // it's left out when folders are.
    if (folder.items.length) {
      const grid = settings.discover
        ? [{
            name: '🖼️ Show as posters',
            description: `Open the ${folder.items.length === 1 ? 'title' : `${folder.items.length} titles`} in "${folder.name}" as posters.\nTap one to open it; back brings you to the posters again.`,
            externalUrl: streamLink(ctx, gridPath(folder, ctx))
          }]
        : [];
      return {
        streams: grid.concat(folder.items.map((item) => ({
          name: item.name,
          description: `${TYPE_LABELS[item.type] || item.type} · tap to open`,
          thumbnail: itemPoster(item),
          externalUrl: openLink(ctx, item.type, item.id)
        })))
      };
    }
    return {
      streams: [{
        name: '📁 S-library',
        description: 'This folder is empty. Open a movie or show and pick this folder in its list of streams.',
        externalUrl: ctx.native ? searchLink('') : `${ctx.configureUrl}#folder=${folder.id}`
      }]
    };
  }
  // A title in a folder's episode-style list (on TVs, and on pages of earlier versions): open it.
  const item = folder && folder.items.find((i) => i.id === video.itemId);
  return {
    streams: [{
      name: '🎬 Open',
      description: item ? `Open "${item.name}"` : 'Tap to open',
      thumbnail: item ? itemPoster(item) : undefined,
      externalUrl: openLink(ctx, video.type, video.itemId)
    }]
  };
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
