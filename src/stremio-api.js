// Minimal client for the Stremio account API (the same API the Stremio apps use).
'use strict';

const { ID_PREFIX, LIMITS, fromLibraryItems, toLibraryItems } = require('./shared');

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

// All of S-library's items in the account: folders, their info and their titles.
async function loadItems(authKey) {
  const modified = await call('datastoreMeta', { authKey, collection: 'libraryItem' });
  const ids = modified.map((entry) => entry[0]).filter((id) => typeof id === 'string' && id.startsWith(ID_PREFIX));
  if (ids.length === 0) return [];
  return call('datastoreGet', { authKey, collection: 'libraryItem', ids, all: false });
}

async function loadFolders(authKey) {
  return fromLibraryItems(await loadItems(authKey));
}

// Stremio asks for the manifest and every folder catalog at once, so folders are cached briefly.
function getFolders(authKey) {
  const hit = cache.get(authKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.promise;
  const entry = { at: Date.now(), promise: loadFolders(authKey) };
  // Failures are not cached.
  entry.promise.catch(() => {
    if (cache.get(authKey) === entry) cache.delete(authKey);
  });
  cache.delete(authKey);
  cache.set(authKey, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry.promise;
}

function forgetFolders(authKey) {
  cache.delete(authKey);
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

// Adds a title to a folder ("add") or takes it out ("remove"), then reads the change back from
// Stremio to make sure it was stored. Returns the folder and the title.
async function changeFolder(authKey, { action, folderId, type, id, baseUrl }) {
  const items = await loadItems(authKey);
  const folder = fromLibraryItems(items).find((f) => f.id === folderId);
  if (!folder) throw new Error("This folder doesn't exist anymore.");
  let title = folder.items.find((item) => item.id === id);
  let next = folder.items;
  if (action === 'add' && !title) {
    if (folder.items.length >= LIMITS.items) throw new Error(`A folder can hold up to ${LIMITS.items} titles.`);
    title = await describeTitle(authKey, type, id);
    next = folder.items.concat(title);
  } else if (action === 'remove' && title) {
    next = folder.items.filter((item) => item.id !== id);
  }
  const changes = toLibraryItems({ ...folder, items: next }, { baseUrl, previous: new Map(items.map((item) => [item._id, item])) });
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
  }
  return { folder, title: title || { id, type, name: id } };
}

module.exports = { request, getFolders, forgetFolders, changeFolder };
