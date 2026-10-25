// Minimal client for the Stremio account API (the same API the Stremio apps use).
'use strict';

const { ID_PREFIX, fromLibraryItems } = require('./shared');

const API_URL = (process.env.STREMIO_API_URL || 'https://api.strem.io').replace(/\/+$/, '') + '/api/';
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

async function loadFolders(authKey) {
  const modified = await call('datastoreMeta', { authKey, collection: 'libraryItem' });
  const ids = modified.map((entry) => entry[0]).filter((id) => typeof id === 'string' && id.startsWith(ID_PREFIX));
  if (ids.length === 0) return [];
  const items = await call('datastoreGet', { authKey, collection: 'libraryItem', ids, all: false });
  return fromLibraryItems(items);
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

module.exports = { request, getFolders, forgetFolders };
