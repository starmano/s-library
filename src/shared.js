// Folder model shared by the addon server (Node) and the configure page (browser).
//
// Folders live in the user's own Stremio library as plain library items. Stremio's servers keep
// only the fields Stremio itself uses and drop anything extra, so each part of a folder is its
// own item, built from those fields alone:
//   slib:<id>                           the folder: type "folder", its name and colored poster;
//                                       listed in Stremio's Library under the "Folder" type
//   slib:<id>:info                      name holds {"d": description, "c": color, "o": order, "i": icon}
//   slib:<id>:title:<type>:<title id>   one per title in the folder, with its name and poster
// The info and title items are marked removed, which keeps them off every Stremio screen.
// A title taken out of a folder keeps its item, with type "slibrary-removed".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SLibrary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ID_PREFIX = 'slib:';
  const TYPE = 'folder';
  const RECORD_TYPE = 'slibrary';
  const REMOVED_RECORD_TYPE = 'slibrary-removed';
  const LIMITS = { name: 60, description: 500, items: 1000 };

  // Preset colors. Stremio shows catalog names as plain text, so the emoji is what marks
  // a folder's row on the Board and in Discover; the hex color is used for the artwork.
  const COLORS = {
    red: { label: 'Red', hex: '#e5484d', emoji: '🔴' },
    orange: { label: 'Orange', hex: '#f76b15', emoji: '🟠' },
    yellow: { label: 'Yellow', hex: '#ffc53d', emoji: '🟡' },
    green: { label: 'Green', hex: '#30a46c', emoji: '🟢' },
    blue: { label: 'Blue', hex: '#3e63dd', emoji: '🔵' },
    purple: { label: 'Purple', hex: '#8e4ec6', emoji: '🟣' },
    brown: { label: 'Brown', hex: '#a18072', emoji: '🟤' },
    black: { label: 'Black', hex: '#2b2b33', emoji: '⚫' },
    white: { label: 'White', hex: '#ededf0', emoji: '⚪' }
  };
  const NO_COLOR = { label: 'None', hex: '#6e6a86', emoji: '📁' };

  // Icons are drawn from icons/icons.json; "folder" is the default folder artwork.
  const DEFAULT_ICON = 'folder';
  function cleanIcon(key) {
    return typeof key === 'string' && /^[a-z-]{1,30}$/.test(key) ? key : DEFAULT_ICON;
  }

  function isColor(key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(COLORS, key);
  }

  function colorOf(key) {
    return isColor(key) ? COLORS[key] : NO_COLOR;
  }

  function cleanText(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  function cleanItem(item) {
    if (!item || typeof item.id !== 'string' || typeof item.type !== 'string' || !item.id || !item.type) return null;
    const out = { id: item.id, type: item.type, name: cleanText(item.name, 200) || item.id };
    if (typeof item.poster === 'string' && /^https?:\/\//.test(item.poster)) out.poster = item.poster;
    return out;
  }

  function cleanItems(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .map(cleanItem)
      .filter((item) => item && !seen.has(item.id) && seen.add(item.id))
      .slice(0, LIMITS.items);
  }

  // "slib:<id>", "slib:<id>:info" or "slib:<id>:title:<type>:<title id>" (title ids may contain ":").
  function parseId(id) {
    if (typeof id !== 'string' || !id.startsWith(ID_PREFIX)) return null;
    const [folderId, kind, type, ...rest] = id.slice(ID_PREFIX.length).split(':');
    if (!folderId) return null;
    if (kind === undefined) return { folderId, kind: 'folder' };
    if (kind === 'info' && type === undefined) return { folderId, kind };
    if (kind === 'title' && type && rest.length > 0) return { folderId, kind, type, titleId: rest.join(':') };
    return null;
  }

  function parseInfo(item) {
    try {
      const info = JSON.parse(item.name);
      return info && typeof info === 'object' ? info : {};
    } catch (_) {
      return {};
    }
  }

  // Folders saved before the info item existed still have their color in the poster URL.
  function colorFromPoster(poster) {
    const match = /\/img\/poster\/([a-z]+)\.png(?:\?|$)/.exec(typeof poster === 'string' ? poster : '');
    return match && isColor(match[1]) ? match[1] : null;
  }

  function time(value) {
    return Date.parse(value) || 0;
  }

  // Reads the folders (not deleted ones) out of a user's library items. Other items are ignored.
  function fromLibraryItems(libraryItems) {
    const folders = new Map();
    const infos = new Map();
    const titles = new Map();
    for (const item of libraryItems) {
      const ref = item && parseId(item._id);
      if (!ref) continue;
      if (ref.kind === 'folder' && item.type === TYPE && !item.removed) folders.set(ref.folderId, item);
      else if (ref.kind === 'info' && item.type === RECORD_TYPE) infos.set(ref.folderId, item);
      else if (ref.kind === 'title' && item.type === RECORD_TYPE) {
        if (!titles.has(ref.folderId)) titles.set(ref.folderId, []);
        titles.get(ref.folderId).push({ id: ref.titleId, type: ref.type, name: item.name, poster: item.poster, added: time(item._ctime) });
      }
    }
    return sortFolders(Array.from(folders, ([id, item]) => {
      const info = infos.has(id) ? parseInfo(infos.get(id)) : {};
      const items = (titles.get(id) || []).sort((a, b) => a.added - b.added || String(a.name).localeCompare(b.name));
      return {
        id,
        name: cleanText(item.name, LIMITS.name) || 'Untitled folder',
        description: cleanText(info.d, LIMITS.description),
        color: isColor(info.c) ? info.c : colorFromPoster(item.poster),
        order: Number.isFinite(info.o) ? info.o : 0,
        icon: cleanIcon(info.i),
        items: cleanItems(items)
      };
    }));
  }

  function sortFolders(folders) {
    return folders.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  // The poster shows the folder's name and icon, so both are part of its address.
  function posterUrl(baseUrl, color, name, icon) {
    const query = [];
    const title = cleanText(name, LIMITS.name);
    if (title) query.push('name=' + encodeURIComponent(title));
    if (cleanIcon(icon) !== DEFAULT_ICON) query.push('icon=' + cleanIcon(icon));
    return baseUrl + '/img/poster/' + (isColor(color) ? color : 'none') + '.png' + (query.length ? '?' + query.join('&') : '');
  }

  function backgroundUrl(baseUrl, color) {
    return baseUrl + '/img/bg/' + (isColor(color) ? color : 'none') + '.png';
  }

  // A library item in the exact shape Stremio itself writes, keeping whatever `previous` had.
  function libraryItem(id, fields, previous, now) {
    return Object.assign({
      _id: id,
      poster: null,
      posterShape: 'poster',
      temp: false,
      _ctime: now,
      state: {
        lastWatched: now,
        timeWatched: 0,
        timeOffset: 0,
        overallTimeWatched: 0,
        timesWatched: 0,
        flaggedWatched: 0,
        duration: 0,
        video_id: null,
        watched: null,
        noNotif: true
      },
      behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false }
    }, previous, fields, { _mtime: now });
  }

  function isUnchanged(previous, fields) {
    return Boolean(previous) && Object.keys(fields).every((key) => previous[key] === fields[key]);
  }

  // The library items to write so the user's library matches `folder`: only the ones that change.
  // `options.previous` maps ids to the library items stored so far.
  function toLibraryItems(folder, options) {
    const nowMs = (options.now || new Date()).getTime();
    const now = new Date(nowMs).toISOString();
    const previous = options.previous;
    const prefix = ID_PREFIX + folder.id;
    const color = isColor(folder.color) ? folder.color : null;
    const changes = [];
    const write = (id, fields) => {
      if (!isUnchanged(previous.get(id), fields)) changes.push(libraryItem(id, fields, previous.get(id), now));
    };

    const name = cleanText(folder.name, LIMITS.name) || 'Untitled folder';
    const icon = cleanIcon(folder.icon);
    write(prefix, { name, type: TYPE, poster: posterUrl(options.baseUrl, color, name, icon), removed: false });
    const info = {
      d: cleanText(folder.description, LIMITS.description),
      c: color,
      o: Number.isFinite(folder.order) ? folder.order : 0
    };
    if (icon !== DEFAULT_ICON) info.i = icon;
    write(prefix + ':info', {
      name: JSON.stringify(info),
      type: RECORD_TYPE,
      removed: true
    });
    const kept = new Set();
    cleanItems(folder.items).forEach((item, index) => {
      const id = `${prefix}:title:${item.type}:${item.id}`;
      const before = previous.get(id);
      const fields = { name: item.name, type: RECORD_TYPE, poster: item.poster || null, removed: true };
      // Newly added titles go to the end, in the order they were added.
      if (!before || before.type !== RECORD_TYPE) fields._ctime = new Date(nowMs + index).toISOString();
      kept.add(id);
      write(id, fields);
    });
    previous.forEach((item, id) => {
      if (id.startsWith(prefix + ':title:') && item.type === RECORD_TYPE && !kept.has(id)) {
        write(id, { type: REMOVED_RECORD_TYPE });
      }
    });
    return changes;
  }

  // Deleting a folder removes it from the library; its other items are then ignored.
  function deletionItems(folderId, options) {
    const id = ID_PREFIX + folderId;
    const now = (options.now || new Date()).toISOString();
    return [libraryItem(id, { removed: true }, options.previous.get(id), now)];
  }

  // The addon URL carries a small base64url JSON config: { k: <Stremio auth key> }.
  function encodeConfig(config) {
    return btoa(JSON.stringify(config)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeConfig(segment) {
    try {
      const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
      const config = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
      return config && typeof config.k === 'string' && config.k.length > 0 ? config : null;
    } catch (_) {
      return null;
    }
  }

  return {
    ID_PREFIX,
    TYPE,
    LIMITS,
    COLORS,
    NO_COLOR,
    DEFAULT_ICON,
    cleanIcon,
    isColor,
    colorOf,
    cleanItems,
    fromLibraryItems,
    sortFolders,
    posterUrl,
    backgroundUrl,
    toLibraryItems,
    deletionItems,
    encodeConfig,
    decodeConfig
  };
});
