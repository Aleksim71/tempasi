// tests/helpers/spawnServer.cjs
/* eslint-env node */
'use strict';

const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Start real Tempasi server for API e2e tests, IN-PROCESS (no nodemon, no child_process).
 *
 * Why:
 * - avoids hanging on logs / nodemon restarts
 * - avoids port collisions with your dev server (:3000)
 * - makes supertest stable + fast
 *
 * Usage:
 *   const { startServer } = require('./helpers/spawnServer.cjs');
 *   srv = await startServer({ databaseUrlTest: process.env.DATABASE_URL_TEST });
 *   await request(srv.baseUrl).get('/__health')
 *   await srv.stop()
 */

function hardUnsetEnv(keys) {
  for (const k of keys) {
    if (process.env[k] !== undefined) delete process.env[k];
  }
}

async function importAppEsm() {
  // project root is process.cwd() when running jest from repo root
  const appPath = path.resolve(process.cwd(), 'src/app.js');
  const appUrl = pathToFileURL(appPath).href;

  // Dynamic ESM import from CJS
  const mod = await import(appUrl);
  const app = mod && (mod.default || mod.app || mod);
  if (!app) {
    throw new Error(`[spawnServer] Cannot import app from ${appPath}`);
  }
  return app;
}

async function startServer(opts = {}) {
  const { databaseUrlTest } = opts;

  // Make test env deterministic
  process.env.NODE_ENV = 'test';
  process.env.TEMPASI_SKIP_WATCHDOG = '1'; // watchdog can hang tests if something is weird
  // (auth MUST stay enabled for /api/profile 401 tests)
  // process.env.TEMPASI_SKIP_AUTH = '1'; // do NOT set in tests unless you intentionally bypass auth

  // Ensure DB selection is correct (db.cjs has priority: PG* env > DATABASE_URL)
  // We want DATABASE_URL to be used in tests.
  hardUnsetEnv(['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE']);

  if (!databaseUrlTest) {
    throw new Error('[spawnServer] startServer requires { databaseUrlTest }');
  }

  // Your code reads DATABASE_URL, while tests pass DATABASE_URL_TEST.
  // So map it.
  process.env.DATABASE_URL = databaseUrlTest;

  const app = await importAppEsm();

  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // port 0 => random free port
    server.listen(0, '127.0.0.1', resolve);
  });

  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : null;
  if (!port) {
    throw new Error('[spawnServer] Cannot determine listening port');
  }

  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    port,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { startServer };
