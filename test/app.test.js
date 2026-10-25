'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// cPanel's "Setup Node.js App" (Phusion Passenger) loads the startup file with require().
test('app.js starts the server when loaded with require()', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ['-e', "require('./app.js')"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), PUBLIC_URL: 'https://s-library.example' }
  });
  t.after(() => child.kill());

  const line = await new Promise((resolve, reject) => {
    child.stdout.once('data', (data) => resolve(data.toString()));
    child.once('exit', (code) => reject(new Error(`exited with code ${code}`)));
  });
  assert.match(line, /S-library running at https:\/\/s-library\.example\/configure/);

  const manifest = await (await fetch(`http://127.0.0.1:${port}/manifest.json`)).json();
  assert.equal(manifest.name, 'S-library');
  assert.equal(manifest.logo, 'https://s-library.example/img/logo.png');
});
