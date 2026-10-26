// S-library: a Stremio addon that adds folders to the Stremio library. No dependencies.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const addon = require('./addon');
const stremio = require('./stremio-api');
const { image } = require('./images');
const { decodeConfig, posterUrl, ID_PREFIX, TYPE } = require('./shared');
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
    actionUrl: `${base}/${configSegment}/act`
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
  const titles = resource === 'stream' && addon.TITLE_TYPES.includes(type);
  if (titles && !config) return sendJson(res, 200, { streams: [] });
  const folders = config && (type === 'folder' || titles) ? await stremio.getFolders(config.k).catch(() => null) : [];
  // Without folders (e.g. Stremio is unreachable) a title gets no entries rather than wrong ones.
  if (titles && !folders) return sendJson(res, 200, { streams: [] });
  const ctx = context(req, configSegment);
  if (resource === 'catalog') {
    const extra = Object.fromEntries(new URLSearchParams(rawExtra ? decode(rawExtra) : ''));
    return sendJson(res, 200, addon.catalog(folders || [], id, extra, ctx));
  }
  if (resource === 'stream') return sendJson(res, 200, addon.stream(folders || [], type, id, ctx));
  const meta = addon.meta(folders || [], id, ctx);
  sendJson(res, meta ? 200 : 404, meta ? { meta } : { err: 'Folder not found' });
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

// "/<config>/act/add|remove/<folder>/<type>/<title>": the folder entries in a title's stream list.
async function actionRoute(req, res, [, configSegment, action, folderId, rawType, rawId]) {
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
  try {
    const { folder, title } = await stremio.changeFolder(config.k, { action, folderId, type, id, baseUrl: ctx.baseUrl });
    const added = action === 'add';
    actionPage(res, 200, {
      image: posterUrl(ctx.baseUrl, folder.color, folder.name, folder.icon),
      heading: added ? `✓ Added to ${folder.name}` : `Taken out of ${folder.name}`,
      text: `"${title.name}" ${added ? 'is now in' : 'is no longer in'} this folder. Press back to return to Stremio.`,
      links: [
        ['Back to Stremio', back, true],
        ['Open the folder', `stremio:///detail/${TYPE}/${encodeURIComponent(ID_PREFIX + folder.id)}`],
        ['Undo', `${ctx.actionUrl}/${added ? 'remove' : 'add'}/${folder.id}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`]
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
  if (method === 'datastorePut') stremio.forgetFolders(body.authKey);
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
  ['GET', /^\/([\w-]+)\/act\/(add|remove)\/([a-z0-9]+)\/([^/]+)\/([^/]+)$/, actionRoute],
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
      sendJson(res, 404, { err: 'Not found' });
    } catch (err) {
      // Paths carry the user's auth key, so only the error message is logged.
      console.error('Request failed:', err.message);
      if (!res.headersSent) sendJson(res, 500, { err: 'Internal error' });
    }
  });
}

module.exports = { createServer };
