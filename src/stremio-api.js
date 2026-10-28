// Minimal client for the Stremio account API (the same API the Stremio apps use).
'use strict';

const { ID_PREFIX, fromLibraryItems, readSettings, migrationItems, playbackResetItems } = require('./shared');

const API_URL = (process.env.STREMIO_API_URL || 'https://api.strem.io').replace(/\/+$/, '') + '/api/';
// Stremio's official catalog addon, for the names and posters of movies and series.
const CINEMETA_URL = (process.env.CINEMETA_URL || 'https://v3-cinemeta.strem.io').replace(/\/+$/, '');
const CACHE_TTL = 15 * 1000;
const CACHE_MAX = 1000;
const cache = new Map();

async function request(method, body) {
  const res = await fetch(API_URL + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function call(method, body) {
  const { status, json } = await request(method, body);
  if (json && json.error) throw new Error(json.error.message || `Stremio API ${method} failed`);
  if (!json || !('result' in json)) throw new Error(`Stremio API ${method} failed (HTTP ${status})`);
  return json.result;
}

// All of S-library's items in the account: folders, their info and titles, and the settings.
async function loadItems(authKey) {
  const modified = await call('datastoreMeta', { authKey, collection: 'libraryItem' });
  const ids = modified.map((entry) => entry[0]).filter((id) => typeof id === 'string' && id.startsWith(ID_PREFIX));
  if (ids.length === 0) return [];
  return call('datastoreGet', { authKey, collection: 'libraryItem', ids, all: false });
}

// Writes `changes`, reads them back to make sure Stremio stored them, and records what it
// stored in `previous` (items by id).
async function save(authKey, changes, previous) {
  await call('datastorePut', { authKey, collection: 'libraryItem', changes });
  const stored = await call('datastoreGet', { authKey, collection: 'libraryItem', ids: changes.map((item) => item._id), all: false });
  const kept = new Map(stored.map((item) => [item._id, item]));
  const lost = changes.some((item) => {
    const saved = kept.get(item._id);
    return !saved || saved.name !== item.name || saved.type !== item.type || saved.removed !== item.removed;
  });
  stored.forEach((item) => previous.set(item._id, item));
  if (lost) throw new Error("Stremio didn't store this change.");
}

// The items by id, brought up to date first (see migrationItems and playbackResetItems in
// shared.js). If that fails, they are read as they are.
async function loadCurrent(authKey) {
  const previous = new Map((await loadItems(authKey)).map((item) => [item._id, item]));
  for (const fix of [migrationItems, playbackResetItems]) {
    const changes = fix(previous);
    if (changes.length > 0) await save(authKey, changes, previous).catch(() => {});
  }
  return previous;
}

function readLibrary(items) {
  return { folders: fromLibraryItems(items), settings: readSettings(items) };
}

// The folders and settings. Stremio asks for the manifest and every folder catalog at once, so
// they're cached briefly.
function getLibrary(authKey) {
  const hit = cache.get(authKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.promise;
  const entry = { at: Date.now(), promise: loadCurrent(authKey).then((previous) => readLibrary([...previous.values()])) };
  // Failures are not cached.
  entry.promise.catch(() => {
    if (cache.get(authKey) === entry) cache.delete(authKey);
  });
  cache.delete(authKey);
  cache.set(authKey, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry.promise;
}

// Drops the cached folders of the account `authKey` belongs to, for every sign-in key it was
// read with (see userId).
async function forgetFolders(authKey) {
  cache.delete(authKey);
  const user = await userId(authKey).catch(() => null);
  if (!user) return;
  for (const key of [...cache.keys()]) {
    if (users.has(key) && (await users.get(key).catch(() => null)) === user) cache.delete(key);
  }
}

// Changes S-library's items: `edit` gets the current folders, settings and items (`previous`,
// by id) and returns { changes, ...result }. The changes are written and checked (see save),
// and the result is returned with the folders and settings after the change.
async function editLibrary(authKey, edit) {
  const previous = await loadCurrent(authKey);
  const { changes = [], ...result } = await edit({ ...readLibrary([...previous.values()]), previous });
  if (changes.length > 0) {
    await save(authKey, changes, previous);
    await forgetFolders(authKey);
  }
  return { ...result, library: readLibrary([...previous.values()]) };
}

// The Stremio account an auth key belongs to. Every sign-in makes a new key, so the addon link
// installed in Stremio and the configure page often have different keys for the same account.
const users = new Map();

function userId(authKey) {
  if (!users.has(authKey)) {
    const promise = call('getUser', { authKey }).then((user) => {
      if (!user || typeof user._id !== 'string') throw new Error('No user');
      return user._id;
    });
    promise.catch(() => users.delete(authKey));
    users.set(authKey, promise);
    if (users.size > CACHE_MAX) users.delete(users.keys().next().value);
  }
  return users.get(authKey);
}

// Stremio keeps its own copy of each installed addon's manifest (Board rows come from it). This
// replaces the copy of every S-library link installed from `baseUrl` (whichever sign-in key it
// carries) with `makeManifest(link)`, leaving other addons as they are.
async function updateInstalledManifest(authKey, baseUrl, makeManifest) {
  const { addons } = await call('addonCollectionGet', { authKey, update: false });
  if (!Array.isArray(addons)) return;
  let changed = false;
  for (const addon of addons) {
    if (!isSLibrary(addon, baseUrl)) continue;
    const manifest = makeManifest(addon.transportUrl);
    if (JSON.stringify(manifest) === JSON.stringify(addon.manifest)) continue;
    addon.manifest = manifest;
    changed = true;
  }
  if (changed) await call('addonCollectionSet', { authKey, addons });
}

// A title's name and poster: from the user's library if it's there, otherwise from Cinemeta.
async function describeTitle(authKey, type, id) {
  const [item] = await call('datastoreGet', { authKey, collection: 'libraryItem', ids: [id], all: false }).catch(() => []);
  if (item && item.name) return { id, type, name: item.name, poster: item.poster || undefined };
  try {
    const res = await fetch(`${CINEMETA_URL}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`, {
      signal: AbortSignal.timeout(8000)
    });
    const { meta } = await res.json();
    if (meta && meta.name) return { id, type, name: meta.name, poster: meta.poster };
  } catch (_) {
    // Fall back to the id.
  }
  return { id, type, name: id };
}

// ---- Streams from the account's other addons ----
//
// Stremio on Samsung and LG TVs can't open a title's page from a stream-list entry (it offers to
// leave Stremio instead), so there a title in a folder gets its streams from the other addons
// installed in the account, the way Stremio itself asks them, to play it from the folder.

const STREAM_TIMEOUT = 10 * 1000;

// Addons S-library may ask: https, and not on this computer or a private network (unless
// ALLOW_PRIVATE_ADDON_URLS is set, e.g. for tests).
function reachableAddon(transportUrl) {
  let url;
  try {
    url = new URL(transportUrl);
  } catch (_) {
    return false;
  }
  if (!url.pathname.endsWith('/manifest.json')) return false;
  if (process.env.ALLOW_PRIVATE_ADDON_URLS) return url.protocol === 'https:' || url.protocol === 'http:';
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host.includes(':')) return !(host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80:'));
  return !(host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^(0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host));
}

// Whether an addon's manifest offers streams for this title. A resource given as an object
// uses only its own types and id prefixes; one given by name uses the manifest's.
function servesStreams(manifest, type, id) {
  return (Array.isArray(manifest.resources) ? manifest.resources : []).some((resource) => {
    const full = resource && typeof resource === 'object';
    if ((full ? resource.name : resource) !== 'stream') return false;
    const types = (full ? resource.types : manifest.types) || [];
    const prefixes = full ? resource.idPrefixes : manifest.idPrefixes;
    return types.includes(type) && (!Array.isArray(prefixes) || prefixes.some((prefix) => id.startsWith(prefix)));
  });
}

// The video to play for a title: a series continues where it was left, or starts at the
// first episode.
async function playableId(authKey, type, id) {
  if (type !== 'series') return id;
  const [item] = await call('datastoreGet', { authKey, collection: 'libraryItem', ids: [id], all: false }).catch(() => []);
  const last = item && item.state && item.state.video_id;
  if (typeof last === 'string' && last.startsWith(`${id}:`)) return last;
  return /^tt\d+$/.test(id) ? `${id}:1:1` : `${id}:1`;
}

async function otherStreams(authKey, type, id) {
  const { addons } = await call('addonCollectionGet', { authKey, update: false });
  const sources = (Array.isArray(addons) ? addons : []).filter((addon) => addon && addon.manifest &&
    addon.manifest.id !== 'community.slibrary' && reachableAddon(addon.transportUrl) && servesStreams(addon.manifest, type, id));
  const lists = await Promise.all(sources.map(async (addon) => {
    const base = addon.transportUrl.slice(0, -'/manifest.json'.length);
    try {
      const res = await fetch(`${base}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`, {
        redirect: 'error',
        signal: AbortSignal.timeout(STREAM_TIMEOUT)
      });
      const { streams } = await res.json();
      return (Array.isArray(streams) ? streams : [])
        .filter((stream) => stream && typeof stream === 'object')
        .map((stream) => ({ ...stream, name: stream.name || addon.manifest.name }));
    } catch (_) {
      return [];
    }
  }));
  return lists.flat();
}

function isSLibrary(addon, baseUrl) {
  return Boolean(addon && addon.manifest && addon.manifest.id === 'community.slibrary' &&
    typeof addon.transportUrl === 'string' && addon.transportUrl.startsWith(`${baseUrl}/`) && addon.transportUrl.endsWith('/manifest.json'));
}

module.exports = {
  request,
  getLibrary,
  forgetFolders,
  editLibrary,
  describeTitle,
  updateInstalledManifest,
  userId,
  playableId,
  otherStreams,
  reachableAddon
};
