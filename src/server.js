// S-library: a Stremio addon that adds folders to the Stremio library. No dependencies.
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const addon = require('./addon');
const stremio = require('./stremio-api');
const { runAction } = require('./actions');
const { image } = require('./images');
const { decodeConfig, readSettings, folderPoster, ID_PREFIX, TYPE } = require('./shared');
const { version } = require('../package.json');

// CHANGELOG.md sections: a "## 1.2.0 — 2026-10-26" heading followed by "- change" lines.
function parseChangelog(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(\d+\.\d+\.\d+)(?:\s+[—–-]\s+(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (heading) entries.push({ version: heading[1], date: heading[2] || null, changes: [] });
    else if (entries.length && /^[-*]\s+/.test(line)) entries[entries.length - 1].changes.push(line.replace(/^[-*]\s+/, '').trim());
  }
  return entries;
}

const FILES = {
  configure: fs.readFileSync(path.join(__dirname, '..', 'public', 'configure.html')),
  shared: fs.readFileSync(path.join(__dirname, 'shared.js')),
  icons: fs.readFileSync(path.join(__dirname, '..', 'icons', 'icons.json')),
  // The running version and what changed, shown on the configure page.
  version: JSON.stringify({
    version,
    changes: parseChangelog(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'))
  })
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
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  // Stremio only accepts https addons away from this computer, so assume https unless told otherwise.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = first(req.headers['x-forwarded-proto']) || (req.socket.encrypted || !local ? 'https' : 'http');
  return `${proto}://${host}`;
}

function context(req, configSegment) {
  const base = baseUrl(req);
  return {
    baseUrl: base,
    manifestUrl: `${base}/${configSegment}/manifest.json`,
    configureUrl: `${base}/${configSegment}/configure`,
    actionUrl: `${base}/${configSegment}/act`,
    // The Stremio apps don't send an Origin header; Stremio Web, running in a browser, does.
    native: !req.headers.origin,
    // Stremio on Samsung (Tizen) and LG (webOS) TVs.
    tv: /SMART-TV|Tizen|Web0S|webOS/i.test(req.headers['user-agent'] || '')
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

// The last requests each account's Stremio apps made, kept in memory only, so the configure page
// can show whether (and how) an app reaches the addon. No auth keys or IP addresses are kept.
// They're filed by Stremio account, as the apps' addon link and the configure page usually
// carry different sign-in keys.
const RECENT_MAX = 40;
const RECENT_ACCOUNTS = 500;
const recent = new Map();

async function accountKey(authKey) {
  const id = await stremio.userId(authKey).then((user) => `user:${user}`, () => `key:${authKey}`);
  return crypto.createHash('sha256').update(id).digest('base64url');
}

function appName(req) {
  const agent = req.headers['user-agent'] || '';
  const [, name] = [
    [/Tizen|SMART-TV/i, 'Samsung TV'],
    [/Web0S|webOS|NetCast/i, 'LG TV'],
    [/AFT[A-Z]|Fire ?TV/i, 'Fire TV'],
    [/Android TV|GoogleTV|BRAVIA|SHIELD/i, 'Android TV'],
    [/Android/i, 'Android'],
    [/iPhone|iPad|iOS/i, 'iPhone / iPad'],
    [/Windows|Macintosh|X11|Linux/i, 'Computer'],
    [/./, 'Unknown app']
  ].find(([pattern]) => pattern.test(agent || '?'));
  // Apps built from Stremio's web version send an Origin header (see context).
  return req.headers.origin ? `${name}, web version` : name;
}

function track(req, res, authKey, what) {
  const started = Date.now();
  let done = false;
  const finish = async (result) => {
    if (done) return;
    done = true;
    const entry = {
      at: new Date(started).toISOString(),
      app: appName(req),
      userAgent: (req.headers['user-agent'] || '').slice(0, 300),
      what: what.slice(0, 200),
      result,
      ms: Date.now() - started
    };
    const key = await accountKey(authKey);
    // Newest first; answers can finish in a different order than their requests started.
    const list = [entry, ...(recent.get(key) || [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    list.length = Math.min(list.length, RECENT_MAX);
    recent.delete(key);
    recent.set(key, list);
    if (recent.size > RECENT_ACCOUNTS) recent.delete(recent.keys().next().value);
  };
  res.on('finish', () => finish(res.statusCode));
  res.on('close', () => finish('closed before the answer was sent'));
}

async function recentRoute(req, res, [, configSegment]) {
  const config = decodeConfig(configSegment);
  if (!config) return sendJson(res, 404, { err: 'Not found' });
  sendJson(res, 200, { requests: recent.get(await accountKey(config.k)) || [] });
}

async function manifestRoute(req, res, [, configSegment]) {
  const config = configSegment && decodeConfig(configSegment);
  if (!config) return sendJson(res, 200, addon.manifest(null, context(req, configSegment)));
  track(req, res, config.k, 'manifest');
  // An unreachable Stremio API must not break the addon: fall back to the "All folders" catalog.
  const library = await stremio.getLibrary(config.k).catch(() => ({ folders: [], settings: readSettings([]) }));
  sendJson(res, 200, addon.manifest(library, context(req, configSegment)));
}

async function resourceRoute(req, res, [, configSegment, resource, type, rawId, rawExtra]) {
  const config = decodeConfig(configSegment);
  const id = decode(rawId);
  const ctx = context(req, configSegment);
  const titles = resource === 'stream' && addon.TITLE_TYPES.includes(type);
  const nothing = () => {
    if (resource === 'catalog') return sendJson(res, 200, { metas: [] });
    if (resource === 'stream') return sendJson(res, 200, { streams: [] });
    sendJson(res, 404, { err: 'Not found' });
  };
  if (config) track(req, res, config.k, `${resource} ${type} ${id}${rawExtra ? ` (${decode(rawExtra)})` : ''}`);
  if (!config || (type !== 'folder' && !titles)) return nothing();
  const action = resource === 'meta' && addon.parseAction(id);
  if (action) return sendJson(res, 200, { meta: await actionPageMeta(config.k, id, action, ctx) });
  // Without the folders (e.g. Stremio is unreachable) show nothing rather than something wrong.
  const library = await stremio.getLibrary(config.k).catch(() => null);
  if (!library) return nothing();
  if (resource === 'catalog') {
    // Stremio encodes each extra value, so a search can hold "&" or "+" of its own.
    const extra = Object.fromEntries(new URLSearchParams(rawExtra || ''));
    return sendJson(res, 200, addon.catalog(library, id, extra, ctx));
  }
  if (resource === 'stream') return sendJson(res, 200, addon.stream(library, type, id, ctx));
  const meta = addon.meta(library, id, ctx);
  sendJson(res, meta ? 200 : 404, meta ? { meta } : { err: 'Folder not found' });
}

// After a change to the folder rows, updates the manifest Stremio keeps for S-library.
function refreshInstalledManifest(authKey, ctx, library) {
  stremio.updateInstalledManifest(authKey, ctx.baseUrl, () => addon.manifest(library, ctx)).catch(() => {});
}

// Runs an in-app action (an "slib:do:..." page) and returns the page to show, also on failure.
async function actionPageMeta(authKey, id, action, ctx) {
  try {
    const outcome = await runAction(authKey, action, ctx);
    if (outcome.structural) refreshInstalledManifest(authKey, ctx, outcome.library);
    const folder = outcome.library.folders.find((f) => f.id === outcome.folderId);
    if (outcome.page !== 'overview' && !folder) {
      return addon.actionMeta(id, { page: 'overview', library: outcome.library, message: "This folder doesn't exist anymore." }, ctx);
    }
    return addon.actionMeta(id, { ...outcome, folder }, ctx);
  } catch (err) {
    const library = await stremio.getLibrary(authKey).catch(() => ({ folders: [], settings: readSettings([]) }));
    return addon.actionMeta(id, { page: 'overview', library, message: `That didn't work: ${err.message} Go back and try again.` }, ctx);
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// The small page a folder action from Stremio's stream list opens: it confirms the change and
// offers a way back. `links` are [label, href, primary?].
function actionPage(res, status, { image, heading, text, links }) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>S-library</title>
<link rel="icon" href="/img/logo.png">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #0d0b14; color: #f3f1fa; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 360px; text-align: center; }
  img { width: 120px; border-radius: 12px; box-shadow: 0 10px 30px rgb(0 0 0 / .45); }
  h1 { font-size: 22px; line-height: 1.25; margin: 18px 0 6px; }
  p { color: #a49fb9; margin: 0 0 22px; }
  a { display: block; margin: 10px 0; padding: 12px 16px; border-radius: 12px; background: #211d2c; border: 1px solid #2e2940; color: #f3f1fa; font-weight: 600; text-decoration: none; }
  a.primary { background: #7b5bf5; border-color: #7b5bf5; color: #fff; }
</style>
</head>
<body>
<main>
  ${image ? `<img src="${escapeHtml(image)}" alt="">` : ''}
  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(text)}</p>
  ${links.map(([label, href, primary]) => `<a${primary ? ' class="primary"' : ''} href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join('\n  ')}
</main>
</body>
</html>`;
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

// "/<config>/act/add/<folder>/<type>/<title>": the folder entries in a title's stream list, for
// Stremio Web, which opens them in a new tab.
async function actionRoute(req, res, [, configSegment, verb, folderId, rawType, rawId]) {
  const config = decodeConfig(configSegment);
  const ctx = context(req, configSegment);
  const type = decode(rawType);
  const id = decode(rawId);
  const back = `stremio:///detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
  if (!config) {
    return actionPage(res, 400, {
      heading: "Couldn't change the folder",
      text: 'This S-library link is incomplete. Reinstall the addon from its configure page.',
      links: [['Back to Stremio', 'stremio:///', true]]
    });
  }
  track(req, res, config.k, `${verb} ${type} ${id} (page)`);
  try {
    const outcome = await runAction(config.k, { verb, folderId, version: 0, arg: `${type}:${id}` }, ctx);
    const folder = outcome.library.folders.find((f) => f.id === folderId);
    if (!folder) throw new Error(outcome.message);
    actionPage(res, 200, {
      image: folderPoster(ctx.baseUrl, folder),
      heading: outcome.message,
      text: 'Press back to return to Stremio.',
      links: [
        ['Back to Stremio', back, true],
        ['Open the folder', `stremio:///detail/${TYPE}/${encodeURIComponent(ID_PREFIX + folder.id)}`],
        ['Wrong folder? Edit folders', `${ctx.configureUrl}#folder=${folder.id}`]
      ]
    });
  } catch (err) {
    actionPage(res, 502, {
      heading: "Couldn't change the folder",
      text: `${err.message} Try again in a moment.`,
      links: [['Back to Stremio', back, true], ['Edit folders', ctx.configureUrl]]
    });
  }
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
  if (method === 'datastorePut') await stremio.forgetFolders(body.authKey).catch(() => {});
  if (!result || !result.json) return sendJson(res, 502, { error: { message: 'Could not reach Stremio. Try again.' } });
  sendJson(res, result.status, result.json);
}

const ROUTES = [
  ['GET', /^\/$/, (req, res) => res.writeHead(302, { location: '/configure' }).end()],
  ['GET', /^\/(?:[\w-]+\/)?configure\/?$/, (req, res) => send(res, 200, FILES.configure, 'text/html; charset=utf-8')],
  ['GET', /^\/shared\.js$/, (req, res) => send(res, 200, FILES.shared, 'text/javascript; charset=utf-8')],
  ['GET', /^\/version\.json$/, (req, res) => send(res, 200, FILES.version, 'application/json; charset=utf-8')],
  ['GET', /^\/icons\.json$/, (req, res) => send(res, 200, FILES.icons, 'application/json; charset=utf-8')],
  ['GET', /^\/img\/(logo)\.png$/, imageRoute],
  ['GET', /^\/img\/(poster|bg)\/([a-z]+)\.png$/, imageRoute],
  ['GET', /^\/(?:([\w-]+)\/)?manifest\.json$/, manifestRoute],
  ['GET', /^\/([\w-]+)\/(catalog|meta|stream)\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/, resourceRoute],
  ['GET', /^\/([\w-]+)\/act\/(add)\/([a-z0-9]+)\/([^/]+)\/([^/]+)$/, actionRoute],
  ['GET', /^\/([\w-]+)\/recent\.json$/, recentRoute],
  ['POST', /^\/api\/(\w+)$/, proxyRoute]
];

function imageRoute(req, res, [, kind, color]) {
  const query = new URL(req.url, 'http://localhost').searchParams;
  const png = image(kind, color, query.get('name') || '', query.get('icon') || undefined);
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
      // Something an app asked for that S-library doesn't know: worth showing too.
      const [, first, ...rest] = pathname.split('/');
      const config = rest.length > 0 && decodeConfig(first);
      if (config) track(req, res, config.k, `unknown request: /${rest.map(decode).join('/')}`);
      sendJson(res, 404, { err: 'Not found' });
    } catch (err) {
      // Paths carry the user's auth key, so only the error message is logged.
      console.error('Request failed:', err.message);
      if (!res.headersSent) sendJson(res, 500, { err: 'Internal error' });
    }
  });
}

module.exports = { createServer };
