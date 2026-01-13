// src/server.js
// ESM entrypoint

import http from 'http';
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
