// Minimal client for the Stremio account API (the same API the Stremio apps use).
'use strict';

const { ID_PREFIX, fromLibraryItems, readSettings } = require('./shared');

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

function readLibrary(items) {
  return { folders: fromLibraryItems(items), settings: readSettings(items) };
}

// The folders and settings. Stremio asks for the manifest and every folder catalog at once, so
// they're cached briefly.
function getLibrary(authKey) {
  const hit = cache.get(authKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.promise;
  const entry = { at: Date.now(), promise: loadItems(authKey).then(readLibrary) };
  // Failures are not cached.
  entry.promise.catch(() => {
    if (cache.get(authKey) === entry) cache.delete(authKey);
  });
  cache.delete(authKey);
  cache.set(authKey, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry.promise;
}

async function getFolders(authKey) {
  return (await getLibrary(authKey)).folders;
}

function forgetFolders(authKey) {
  cache.delete(authKey);
}

// Changes S-library's items: `edit` gets the current folders, settings and items (`previous`,
// by id) and returns { changes, ...result }. The changes are written, read back to make sure
// Stremio stored them, and the result is returned with the folders and settings after the change.
async function editLibrary(authKey, edit) {
  const items = await loadItems(authKey);
  const previous = new Map(items.map((item) => [item._id, item]));
  const { changes = [], ...result } = await edit({ ...readLibrary(items), previous });
  if (changes.length > 0) {
    await call('datastorePut', { authKey, collection: 'libraryItem', changes });
    forgetFolders(authKey);
    const stored = await call('datastoreGet', { authKey, collection: 'libraryItem', ids: changes.map((item) => item._id), all: false });
    const kept = new Map(stored.map((item) => [item._id, item]));
    const lost = changes.some((item) => {
      const saved = kept.get(item._id);
      return !saved || saved.name !== item.name || saved.type !== item.type || saved.removed !== item.removed;
    });
    if (lost) throw new Error("Stremio didn't store this change.");
    stored.forEach((item) => previous.set(item._id, item));
  }
  return { ...result, library: readLibrary([...previous.values()]) };
}

// Stremio keeps its own copy of each installed addon's manifest (Board rows come from it). This
// replaces the copy of every installed S-library link ending in `suffix` with `makeManifest(link)`,
// leaving other addons as they are.
async function updateInstalledManifest(authKey, suffix, makeManifest) {
  const { addons } = await call('addonCollectionGet', { authKey, update: false });
  if (!Array.isArray(addons)) return;
  let changed = false;
  for (const addon of addons) {
    if (!addon || typeof addon.transportUrl !== 'string' || !addon.transportUrl.endsWith(suffix)) continue;
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

module.exports = { request, getLibrary, getFolders, forgetFolders, editLibrary, describeTitle, updateInstalledManifest };
