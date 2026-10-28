// Folder model shared by the addon server (Node) and the configure page (browser).
//
// Folders live in the user's own Stremio library as plain library items. Stremio's servers keep
// only the fields Stremio itself uses and drop anything extra, so each part of a folder is its
// own item, built from those fields alone:
//   slib:<id>                           the folder: type "folder", its name and colored poster;
//                                       listed in Stremio's Library under the "Folder" type
//   slib:<id>:info                      name holds {"d": description, "c": color, "o": order,
//                                       "i": icon, "h": 1 when the name is left off the poster,
//                                       "t": version (time of the last edit)}
//   slib:<id>:title:<type>:<title id>   one per title in the folder, with its name and poster
//   slib::settings                      name holds {"library", "discover", "search": where in
//                                       Stremio folders show, "t": version, "k": 1 (see
//                                       migrationItems)}
// The info, title and settings items are marked removed, which keeps them off every Stremio
// screen. A folder is hidden from the Library the same way, by the Library switch or by
// Stremio's own "Remove from library" button. A deleted folder, or a title taken out of a
// folder, keeps its item, with type "slibrary-removed".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SLibrary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ID_PREFIX = 'slib:';
  const TYPE = 'folder';
  const RECORD_TYPE = 'slibrary';
  const REMOVED_RECORD_TYPE = 'slibrary-removed';
  const SETTINGS_ID = ID_PREFIX + ':settings';
  const LIMITS = { name: 60, description: 500, items: 1000 };

  // Preset colors. Stremio shows catalog names as plain text, so the emoji is what marks
  // a folder's row on the Board and in Discover; the hex color is used for the artwork.
  // Stremio shows row names as plain text, so a colored emoji shape is the only color they can
  // carry. There are colored circles for nine colors; the other shades get the nearest colored
  // square, heart or diamond, so every color still has its own mark.
  const COLORS = {
    red: { label: 'Red', hex: '#e5484d', emoji: '🔴' },
    wine: { label: 'Wine', hex: '#8e2140', emoji: '🟥' },
    pink: { label: 'Pink', hex: '#e93d82', emoji: '💗' },
    peach: { label: 'Peach', hex: '#ff977d', emoji: '🟧' },
    orange: { label: 'Orange', hex: '#f76b15', emoji: '🟠' },
    gold: { label: 'Gold', hex: '#c9a227', emoji: '🟨' },
    yellow: { label: 'Yellow', hex: '#ffc53d', emoji: '🟡' },
    lime: { label: 'Lime', hex: '#8ec63f', emoji: '🟩' },
    green: { label: 'Green', hex: '#30a46c', emoji: '🟢' },
    mint: { label: 'Mint', hex: '#3cc6a5', emoji: '💚' },
    sky: { label: 'Sky', hex: '#3fb6ef', emoji: '🔷' },
    blue: { label: 'Blue', hex: '#3e63dd', emoji: '🔵' },
    navy: { label: 'Navy', hex: '#273a7a', emoji: '🟦' },
    purple: { label: 'Purple', hex: '#8e4ec6', emoji: '🟣' },
    brown: { label: 'Brown', hex: '#a18072', emoji: '🟤' },
    gray: { label: 'Gray', hex: '#9b9ca6', emoji: '🔘' },
    black: { label: 'Black', hex: '#2b2b33', emoji: '⚫' },
    white: { label: 'White', hex: '#ededf0', emoji: '⚪' }
  };
  const NO_COLOR = { label: 'None', hex: '#6e6a86', emoji: '📁' };

  // Icons are drawn from icons/icons.json; "folder" is the default folder artwork, and "none"
  // leaves the poster without one.
  const DEFAULT_ICON = 'folder';
  const NO_ICON = 'none';
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

  // Where folders show in Stremio: its Library, Discover (and the Board, which shows the same
  // rows), and search. Each is on unless switched off.
  const SETTINGS = ['library', 'discover', 'search'];

  function readSettings(libraryItems) {
    for (const item of libraryItems) {
      if (item && item._id === SETTINGS_ID && item.type === RECORD_TYPE) {
        const stored = parseInfo(item);
        const settings = {};
        SETTINGS.forEach((key) => { settings[key] = stored[key] !== false; });
        return Object.assign(settings, { version: Number.isFinite(stored.t) ? stored.t : 0, keep: stored.k === 1, stored: true });
      }
    }
    return { library: true, discover: true, search: true, version: 0, keep: false, stored: false };
  }

  // Reads the folders (not deleted ones) out of a user's library items. Other items are ignored.
  function fromLibraryItems(libraryItems) {
    const items = Array.from(libraryItems);
    // A folder removed from the Library is still a folder; deleted ones have another type.
    // Before migrationItems has run, a folder removed from the Library while folders were shown
    // there was deleted: that's what Stremio's own "Remove from library" button used to mean.
    const { library, keep } = readSettings(items);
    const folders = new Map();
    const infos = new Map();
    const titles = new Map();
    for (const item of items) {
      const ref = item && parseId(item._id);
      if (!ref) continue;
      if (ref.kind === 'folder' && item.type === TYPE && (keep || !library || !item.removed)) folders.set(ref.folderId, item);
      else if (ref.kind === 'info' && item.type === RECORD_TYPE) infos.set(ref.folderId, item);
      else if (ref.kind === 'title' && item.type === RECORD_TYPE) {
        if (!titles.has(ref.folderId)) titles.set(ref.folderId, []);
        titles.get(ref.folderId).push({ id: ref.titleId, type: ref.type, name: item.name, poster: item.poster, added: time(item._ctime) });
      }
    }
    return sortFolders(Array.from(folders, ([id, item]) => {
      const info = infos.has(id) ? parseInfo(infos.get(id)) : {};
      const titleList = (titles.get(id) || []).sort((a, b) => a.added - b.added || String(a.name).localeCompare(b.name));
      return {
        id,
        name: cleanText(item.name, LIMITS.name) || 'Untitled folder',
        description: cleanText(info.d, LIMITS.description),
        color: isColor(info.c) ? info.c : colorFromPoster(item.poster),
        order: Number.isFinite(info.o) ? info.o : 0,
        icon: cleanIcon(info.i),
        showName: info.h !== 1,
        version: Number.isFinite(info.t) ? info.t : 0,
        items: cleanItems(titleList)
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

  function folderPoster(baseUrl, folder) {
    return posterUrl(baseUrl, folder.color, folder.showName === false ? '' : folder.name, folder.icon);
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

  // Objects (behaviorHints) are compared by the fields given.
  function isUnchanged(previous, fields) {
    const same = (before, value) => (value && typeof value === 'object'
      ? Boolean(before) && Object.keys(value).every((key) => before[key] === value[key])
      : before === value);
    return Boolean(previous) && Object.keys(fields).every((key) => same(previous[key], fields[key]));
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
    // A folder stays in or out of the Library as it was; a new one follows the Library switch.
    const before = previous.get(prefix);
    const removed = before && before.type === TYPE ? Boolean(before.removed) : !readSettings(previous.values()).library;
    const poster = folderPoster(options.baseUrl, { color, name, icon, showName: folder.showName });
    // No default video: opened from the Library, a folder page then shows its stream list, or on
    // TVs its titles (see folderMeta in addon.js). Version 1.12.1 set one; this undoes that.
    const behaviorHints = { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false };
    write(prefix, { name, type: TYPE, poster, removed, behaviorHints });
    const info = {
      d: cleanText(folder.description, LIMITS.description),
      c: color,
      o: Number.isFinite(folder.order) ? folder.order : 0
    };
    if (icon !== DEFAULT_ICON) info.i = icon;
    if (folder.showName === false) info.h = 1;
    if (folder.version) info.t = folder.version;
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
    return [libraryItem(id, { type: REMOVED_RECORD_TYPE, removed: true }, options.previous.get(id), now)];
  }

  // The library items to write to change where folders show: `update` holds the settings that
  // change, e.g. { library: false }. Switching the Library on or off shows or hides every folder.
  function settingsItems(update, options) {
    const nowMs = (options.now || new Date()).getTime();
    const now = new Date(nowMs).toISOString();
    const previous = options.previous;
    const current = readSettings(previous.values());
    const next = {};
    SETTINGS.forEach((key) => { next[key] = typeof update[key] === 'boolean' ? update[key] : current[key]; });
    if (current.keep && SETTINGS.every((key) => next[key] === current[key])) return [];
    const changes = [];
    previous.forEach((item, id) => {
      const ref = parseId(id);
      if (!ref || ref.kind !== 'folder' || item.type !== TYPE) return;
      if (!current.keep && current.library && item.removed) changes.push(libraryItem(id, { type: REMOVED_RECORD_TYPE }, item, now));
      else if (current.library !== next.library && item.removed === next.library) changes.push(libraryItem(id, { removed: !next.library }, item, now));
    });
    changes.push(libraryItem(SETTINGS_ID, {
      name: JSON.stringify(Object.assign(next, { t: nowMs, k: 1 })),
      type: RECORD_TYPE,
      removed: true
    }, previous.get(SETTINGS_ID), now));
    return changes;
  }

  // Up to version 1.5, Stremio's own "Remove from library" button deleted a folder, with no
  // way back. Now it only takes the folder out of the Library. This runs once per account: it
  // marks the folders removed that way as deleted, as they were, and records that it's done.
  function migrationItems(previous, options) {
    return readSettings(previous.values()).keep ? [] : settingsItems({}, Object.assign({}, options, { previous }));
  }

  // Stremio keeps watch progress on whatever it plays. A title played from a folder on a TV is
  // played as one of the folder's videos, so the folder gets the progress: Stremio then opens the
  // folder on that title (from the Library or Continue Watching) instead of as a folder. So the
  // progress is moved to the title (see progressItems), and these items clear it from folders.
  const PLAYBACK = { video_id: null, timeOffset: 0, timeWatched: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0 };

  function playbackResetItems(previous, options) {
    const now = ((options && options.now) || new Date()).toISOString();
    const changes = [];
    previous.forEach((item, id) => {
      const ref = parseId(id);
      if (!ref || ref.kind !== 'folder' || item.type !== TYPE || !item.state) return;
      if (Object.keys(PLAYBACK).every((key) => !item.state[key])) return;
      changes.push(libraryItem(id, { state: Object.assign({}, item.state, PLAYBACK) }, item, now));
    });
    return changes;
  }

  // The titles that progress on folders belongs to: their video ids look like
  // "slib:<folder id>:<type>:<title id>" (see addon.js).
  function playedTitles(previous) {
    const played = [];
    previous.forEach((item, id) => {
      const ref = parseId(id);
      if (!ref || ref.kind !== 'folder' || item.type !== TYPE || !item.state) return;
      const { video_id: videoId, timeOffset, timesWatched, flaggedWatched } = item.state;
      if (typeof videoId !== 'string' || !videoId.startsWith(id + ':') || !(timeOffset > 0 || timesWatched > 0 || flaggedWatched > 0)) return;
      const rest = videoId.slice(id.length + 1);
      const split = rest.indexOf(':');
      if (split > 0) played.push({ folder: item, type: rest.slice(0, split), id: rest.slice(split + 1) });
    });
    return played;
  }

  // Library items that give those titles the progress, the way Stremio keeps progress of a title
  // that's not in the Library: removed, but temporary, so it shows in Continue Watching. Titles
  // with newer progress of their own are left alone. `titles` maps title ids to their library
  // items, if any.
  function progressItems(previous, titles, options) {
    const now = ((options && options.now) || new Date()).toISOString();
    const changes = [];
    playedTitles(previous).forEach(({ folder, type, id }) => {
      const before = titles.get(id);
      const own = (before && before.state) || {};
      const played = folder.state;
      if (before && time(own.lastWatched) >= time(played.lastWatched)) return;
      const record = previous.get(folder._id + ':title:' + type + ':' + id) || {};
      // A series continues with the episode it was at, or starts with the first (as in addon.js).
      const episode = typeof own.video_id === 'string' && own.video_id.startsWith(id + ':')
        ? own.video_id
        : /^tt\d+$/.test(id) ? id + ':1:1' : id + ':1';
      const fields = {
        type,
        state: Object.assign({}, libraryItem(id, {}, null, now).state, own, {
          lastWatched: played.lastWatched || now,
          video_id: type === 'series' ? episode : id,
          timeOffset: played.timeOffset || 0,
          duration: played.duration || 0,
          timeWatched: played.timeWatched || 0,
          overallTimeWatched: (own.overallTimeWatched || 0) + (played.overallTimeWatched || 0),
          timesWatched: (own.timesWatched || 0) + (played.timesWatched || 0),
          flaggedWatched: Math.max(own.flaggedWatched || 0, played.flaggedWatched || 0)
        })
      };
      if (!before) {
        Object.assign(fields, {
          name: record.name || id,
          poster: record.poster || null,
          removed: true,
          temp: true,
          behaviorHints: { defaultVideoId: type === 'series' ? null : id, featuredVideoId: null, hasScheduledVideos: false }
        });
      }
      changes.push(libraryItem(id, fields, before, now));
    });
    return changes;
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
    NO_ICON,
    cleanIcon,
    isColor,
    colorOf,
    cleanItems,
    fromLibraryItems,
    readSettings,
    sortFolders,
    posterUrl,
    folderPoster,
    backgroundUrl,
    toLibraryItems,
    deletionItems,
    settingsItems,
    migrationItems,
    playbackResetItems,
    playedTitles,
    progressItems,
    encodeConfig,
    decodeConfig
  };
});
