// S-library: a Stremio addon that adds folders to the Stremio library. No dependencies.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const addon = require('./addon');
const stremio = require('./stremio-api');
const { image } = require('./images');
const { decodeConfig } = require('./shared');

const FILES = {
  configure: fs.readFileSync(path.join(__dirname, '..', 'public', 'configure.html')),
  shared: fs.readFileSync(path.join(__dirname, 'shared.js'))
};

// Stremio API calls the configure page may make through this server.
const PROXY_METHODS = new Set([
  'login',
  'datastoreMeta',
  'datastoreGet',
  'datastorePut',
  'addonCollectionGet',
  'addonCollectionSet'
]);
const MAX_BODY = 10 * 1024 * 1024;
const LOGIN_LIMIT = 10; // attempts per IP per minute
const loginAttempts = new Map();

function send(res, status, body, type, cacheControl = 'no-cache') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': cacheControl,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*'
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const first = (value) => (value || '').split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function context(req, configSegment) {
  const base = baseUrl(req);
  return {
    baseUrl: base,
    manifestUrl: `${base}/${configSegment}/manifest.json`,
    configureUrl: `${base}/${configSegment}/configure`
  };
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function tooManyLogins(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.reset) {
    if (loginAttempts.size > 10000) loginAttempts.clear();
    loginAttempts.set(ip, { count: 1, reset: now + 60 * 1000 });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_LIMIT;
}

async function manifestRoute(req, res, [, configSegment]) {
  const config = configSegment && decodeConfig(configSegment);
  if (!config) return sendJson(res, 200, addon.manifest(null, context(req, configSegment)));
  // An unreachable Stremio API must not break the addon: fall back to the "All folders" catalog.
  const folders = await stremio.getFolders(config.k).catch(() => []);
  sendJson(res, 200, addon.manifest(folders, context(req, configSegment)));
}

async function resourceRoute(req, res, [, configSegment, resource, type, rawId, rawExtra]) {
  const config = decodeConfig(configSegment);
  const id = decode(rawId);
  const folders = config && type === 'folder' ? await stremio.getFolders(config.k).catch(() => []) : [];
  const ctx = context(req, configSegment);
  if (resource === 'catalog') {
    const extra = Object.fromEntries(new URLSearchParams(rawExtra ? decode(rawExtra) : ''));
    return sendJson(res, 200, addon.catalog(folders, id, extra, ctx));
  }
  if (resource === 'stream') return sendJson(res, 200, addon.stream(folders, id));
  const meta = addon.meta(folders, id, ctx);
  sendJson(res, meta ? 200 : 404, meta ? { meta } : { err: 'Folder not found' });
}

async function proxyRoute(req, res, [, method]) {
  if (!PROXY_METHODS.has(method)) return sendJson(res, 404, { error: { message: 'Unknown method' } });
  if (method === 'login' && tooManyLogins(req)) {
    return sendJson(res, 429, { error: { message: 'Too many sign-in attempts. Try again in a minute.' } });
  }
  const body = await readJson(req);
  if (!body || (method.startsWith('datastore') && body.collection !== 'libraryItem')) {
    return sendJson(res, 400, { error: { message: 'Invalid request' } });
  }
  const result = await stremio.request(method, body).catch(() => null);
  if (method === 'datastorePut') stremio.forgetFolders(body.authKey);
  if (!result || !result.json) return sendJson(res, 502, { error: { message: 'Could not reach Stremio. Try again.' } });
  sendJson(res, result.status, result.json);
}

const ROUTES = [
  ['GET', /^\/$/, (req, res) => res.writeHead(302, { location: '/configure' }).end()],
  ['GET', /^\/(?:[\w-]+\/)?configure\/?$/, (req, res) => send(res, 200, FILES.configure, 'text/html; charset=utf-8')],
  ['GET', /^\/shared\.js$/, (req, res) => send(res, 200, FILES.shared, 'text/javascript; charset=utf-8')],
  ['GET', /^\/img\/(logo)\.png$/, imageRoute],
  ['GET', /^\/img\/(poster|bg)\/([a-z]+)\.png$/, imageRoute],
  ['GET', /^\/(?:([\w-]+)\/)?manifest\.json$/, manifestRoute],
  ['GET', /^\/([\w-]+)\/(catalog|meta|stream)\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/, resourceRoute],
  ['POST', /^\/api\/(\w+)$/, proxyRoute]
];

function imageRoute(req, res, [, kind, color]) {
  const png = image(kind, color);
  if (!png) return sendJson(res, 404, { err: 'Not found' });
  send(res, 200, png, 'image/png', 'public, max-age=86400');
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      for (const [method, pattern, handler] of ROUTES) {
        const match = req.method === method && pathname.match(pattern);
        if (match) return await handler(req, res, match);
      }
      sendJson(res, 404, { err: 'Not found' });
    } catch (err) {
      // Paths carry the user's auth key, so only the error message is logged.
      console.error('Request failed:', err.message);
      if (!res.headersSent) sendJson(res, 500, { err: 'Internal error' });
    }
  });
}

module.exports = { createServer };
