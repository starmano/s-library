// In-memory stand-in for api.strem.io, covering the calls S-library makes.
'use strict';

const http = require('node:http');

function startFakeApi({ email = 'me@example.com', password = 'secret', authKey = 'test-auth-key', items = [], addons = [] } = {}) {
  const store = new Map(items.map((item) => [item._id, item]));
  const collection = { addons };
  const calls = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
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
        return reply({ result: [...store.values()].map((item) => [item._id, Date.parse(item._mtime)]) });
      }
      if (method === 'datastoreGet') {
        return reply({ result: body.all ? [...store.values()] : body.ids.map((id) => store.get(id)).filter(Boolean) });
      }
      if (method === 'datastorePut') {
        body.changes.forEach((item) => store.set(item._id, item));
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
      resolve({ url: `http://127.0.0.1:${server.address().port}`, store, collection, calls, close: () => server.close() });
    });
  });
}

module.exports = { startFakeApi };
