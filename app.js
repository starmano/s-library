// Starts S-library. Used by `npm start`, the Dockerfile and hosting panels such as cPanel's
// "Setup Node.js App", which load this file with require() rather than running it directly.
'use strict';

const { createServer } = require('./src/server');

const port = Number(process.env.PORT) || 7000;
const publicUrl = process.env.PUBLIC_URL || `http://127.0.0.1:${port}`;

createServer().listen(port, () => {
  console.log(`S-library running at ${publicUrl.replace(/\/+$/, '')}/configure`);
});
