// In-memory stand-in for api.strem.io (and Cinemeta's meta lookups), covering the calls S-library makes.
'use strict';

const http = require('node:http');

// Like the real API, keep only the fields Stremio's own library items have and drop the rest.
const ITEM_FIELDS = ['_id', 'name', 'type', 'poster', 'posterShape', 'removed', 'temp', '_ctime', '_mtime', 'state'];
const HINT_FIELDS = ['defaultVideoId', 'featuredVideoId', 'hasScheduledVideos'];

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object && key in object).map((key) => [key, object[key]]));
}

function keepStremioFields(item) {
  return { ...pick(item, ITEM_FIELDS), behaviorHints: pick(item.behaviorHints, HINT_FIELDS) };
}

function startFakeApi({ email = 'me@example.com', password = 'secret', authKey = 'test-auth-key', items = [], addons = [], cinemeta = {} } = {}) {
  const library = new Map(items.map((item) => [item._id, keepStremioFields(item)]));
  const collection = { addons };
  const calls = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      // A stand-in for Cinemeta's meta resource, for title names.
      const meta = /^\/meta\/[^/]+\/([^/]+)\.json$/.exec(req.url);
      if (meta) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(cinemeta[meta[1]] ? { meta: cinemeta[meta[1]] } : {}));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const method = req.url.replace('/api/', '');
      calls.push({ method, body });
      const reply = (data) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (method === 'login') {
        return body.email === email && body.password === password
          ? reply({ result: { authKey, user: { email } } })
          : reply({ error: { message: 'Wrong email or password', code: 2 } });
      }
      if (body.authKey !== authKey) return reply({ error: { message: 'Session does not exist', code: 1 } });
      if (method === 'datastoreMeta') {
        return reply({ result: [...library.values()].map((item) => [item._id, Date.parse(item._mtime)]) });
      }
      if (method === 'datastoreGet') {
        return reply({ result: body.all ? [...library.values()] : body.ids.map((id) => library.get(id)).filter(Boolean) });
      }
      if (method === 'datastorePut') {
        body.changes.forEach((item) => library.set(item._id, keepStremioFields(item)));
        return reply({ result: { success: true } });
      }
      if (method === 'addonCollectionGet') return reply({ result: { addons: collection.addons, lastModified: new Date() } });
      if (method === 'addonCollectionSet') {
        collection.addons = body.addons;
        return reply({ result: { success: true } });
      }
      reply({ error: { message: 'Unknown method', code: 0 } });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, library, collection, calls, close: () => server.close() });
    });
  });
}

module.exports = { startFakeApi, keepStremioFields };
