// src/server.js
import { createApp } from './app.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err);
});

async function start() {
  const app = await createApp();

  app.listen(PORT, HOST, () => {
    console.log(`[tempasi] listening on http://${HOST}:${PORT}`);
  });
}

start();
