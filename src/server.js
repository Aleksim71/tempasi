// src/server.js
import dotenv from 'dotenv';
dotenv.config();

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// TEMPASI_RESTORE_PROTOCOL (2026-08-14): scripts/restore-full.sh needs
// a reliable way to find and gracefully stop the currently-running
// server before restoring the DB, then start a fresh one back up
// afterwards. A PID file is that handle — written once the server is
// actually listening, removed on graceful shutdown.
const PID_FILE = path.resolve(__dirname, '..', '.server.pid');

// Load the "main" app from src/app.js (session/db/api/web should be wired up there, in the right order)
async function loadAppFromAppJs() {
  const mod = await import('./app.js');
  const m = mod?.default ?? mod;

  // 1) if a ready-made app is exported
  if (m && typeof m === 'function' && typeof m.use === 'function') return m;
  if (mod?.app && typeof mod.app === 'function' && typeof mod.app.use === 'function')
    return mod.app;

  // 2) if createApp() is exported
  const create =
    mod?.createApp ||
    (m && typeof m === 'object' ? m.createApp : null) ||
    (typeof m === 'function' ? m : null);

  if (typeof create === 'function') {
    const out = await create({});
    // createApp can return app, or { app }
    const app = out?.app ?? out;
    if (app && typeof app === 'function' && typeof app.use === 'function') return app;
  }

  const keys = mod ? Object.keys(mod) : [];
  const mKeys = m && typeof m === 'object' ? Object.keys(m) : [];
  throw new Error(
    `[server] Cannot load Express app from src/app.js. ` +
      `Exports keys=${keys.join(',') || '(none)'}; default keys=${mKeys.join(',') || '(none)'}`,
  );
}

export const app = await loadAppFromAppJs();

// Do NOT listen on a port in tests (important!)
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer(app);
  server.listen(port, () => {
    console.log(`🚀 Server running on http://127.0.0.1:${port}`);
    try {
      fs.writeFileSync(PID_FILE, String(process.pid));
    } catch (e) {
      console.warn(`[server] could not write pid file: ${e.message}`);
    }
  });

  function shutdown(signal) {
    console.log(`[server] received ${signal}, shutting down...`);
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // already gone / never written — fine
    }
    server.close(() => process.exit(0));
    // Don't hang forever if something's still holding a connection open.
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
