// src/server.js
import 'dotenv/config';
import http from 'http';
import { createApp } from './app.js';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);

function log(...args) {
   
  console.log('[tempasi]', ...args);
}

async function main() {
  const app = createApp();

  const server = http.createServer(app);

  server.listen(PORT, HOST, () => {
    log(`listening on http://${HOST}:${PORT}`);
  });

  const shutdown = (signal) => {
    log(`${signal} received, shutting down...`);
    server.close(() => {
      log('server closed');
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    log('unhandledRejection', err);
  });

  process.on('uncaughtException', (err) => {
    log('uncaughtException', err);
  });
}

main().catch((err) => {
   
  console.error('[tempasi] fatal', err);
  process.exit(1);
});
