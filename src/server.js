// src/server.js
// ESM entrypoint

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import http from 'http';

// Load .env from project root BEFORE importing the app (critical for ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Import app AFTER env is loaded (so db config sees env vars)
import app from './app.js';

const PORT = Number(process.env.PORT || 3000);

// IMPORTANT:
// 1) IPv6 (::) может НЕ принимать IPv4 (127.0.0.1) на некоторых системах.
// 2) Тесты у тебя ходят на 127.0.0.1 → поэтому дефолт делаем IPv4.
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : PORT;
  const shownHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;

  console.log(`[tempasi] listening on http://${shownHost}:${actualPort}`);
});

// Graceful shutdown for dev/test
function shutdown(signal) {
  console.log(`[tempasi] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default server;
