// Folder model shared by the addon server (Node) and the configure page (browser).
//
// A folder is stored as a regular item in the user's Stremio library:
//   _id            "slib:<folder id>"
//   type           "folder"  (shows up as its own type filter in Stremio's Library)
//   name           folder name
//   poster         colored folder artwork served by this addon
//   behaviorHints  { slibrary: { description, color, order, items } }
// Stremio keeps unknown behaviorHints fields when it syncs the library, so the folder
// contents travel with the user's account and no database is needed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SLibrary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ID_PREFIX = 'slib:';
  const TYPE = 'folder';
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

  function isFolderItem(item) {
    return Boolean(item) && typeof item._id === 'string' && item._id.startsWith(ID_PREFIX) && item.type === TYPE;
  }

  function fromLibraryItem(item) {
    if (!isFolderItem(item)) return null;
    const data = (item.behaviorHints && item.behaviorHints.slibrary) || {};
    return {
      id: item._id.slice(ID_PREFIX.length),
      name: cleanText(item.name, LIMITS.name) || 'Untitled folder',
      description: cleanText(data.description, LIMITS.description),
      color: isColor(data.color) ? data.color : null,
      order: Number.isFinite(data.order) ? data.order : 0,
      items: cleanItems(data.items),
      removed: Boolean(item.removed)
    };
  }

  function sortFolders(folders) {
    return folders.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  function folderData(folder) {
    return {
      v: 1,
      description: cleanText(folder.description, LIMITS.description),
      color: isColor(folder.color) ? folder.color : null,
      order: Number.isFinite(folder.order) ? folder.order : 0,
      items: cleanItems(folder.items)
    };
  }

  function posterUrl(baseUrl, color) {
    return baseUrl + '/img/poster/' + (isColor(color) ? color : 'none') + '.png';
  }

  function backgroundUrl(baseUrl, color) {
    return baseUrl + '/img/bg/' + (isColor(color) ? color : 'none') + '.png';
  }

  // Builds the library item for a folder, in the exact shape Stremio itself writes.
  // `previous` is the folder's current library item (if any) so watch state and
  // creation time survive edits.
  function toLibraryItem(folder, options) {
    const now = (options.now || new Date()).toISOString();
    const previous = options.previous || {};
    const data = folderData(folder);
    return Object.assign({}, previous, {
      _id: ID_PREFIX + folder.id,
      name: cleanText(folder.name, LIMITS.name) || 'Untitled folder',
      type: TYPE,
      poster: posterUrl(options.baseUrl, data.color),
      posterShape: 'poster',
      removed: false,
      temp: false,
      _ctime: previous._ctime || now,
      _mtime: now,
      state: Object.assign({
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
      }, previous.state),
      behaviorHints: Object.assign({
        defaultVideoId: null,
        featuredVideoId: null,
        hasScheduledVideos: false
      }, previous.behaviorHints, { slibrary: data })
    });
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
    isColor,
    colorOf,
    cleanItems,
    folderData,
    isFolderItem,
    fromLibraryItem,
    sortFolders,
    posterUrl,
    backgroundUrl,
    toLibraryItem,
    encodeConfig,
    decodeConfig
  };
});
