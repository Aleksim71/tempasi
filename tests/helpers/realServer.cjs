// tests/helpers/realServer.cjs
/* eslint-env node */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

// IMPORTANT:
// Many suites call migrateDb() themselves, but some (like /templates render smoke)
// may spin up a real server without doing DB prep first.
// That can cause flaky 500s depending on what DB the app points to.
// We fix it by:
//  1) forcing DATABASE_URL to DATABASE_URL_TEST (when present)
//  2) running migrateDb() once per Jest worker process (idempotent)

let didMigrate = false;

function ensureTestDbEnv() {
  if (process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }
}

async function ensureMigratedOnce() {
  if (didMigrate) return;

  // Only migrate when we have test DB configured
  if (!process.env.DATABASE_URL_TEST) return;

  // Force app to use test DB url
  ensureTestDbEnv();

  // Lazy require (keeps this helper standalone)
  // migrateDb() is expected to be idempotent and safe to call multiple times,
  // but we still guard it per-process.
  const { migrateDb } = require('./migrateDb.cjs');
  await migrateDb();

  didMigrate = true;
}

async function loadExpressApp() {
  // Ensure env + schema before app boot
  await ensureMigratedOnce();

  const appPath = path.resolve(process.cwd(), 'src/app.js');
  const mod = await import(pathToFileURL(appPath).href);

  const app = mod && (mod.default || mod.app);
  if (!app || typeof app !== 'function') {
    const keys = mod && typeof mod === 'object' ? Object.keys(mod) : [];
    throw new Error(
      `[realServer] Loaded ${appPath}, but no express app export found. keys=${JSON.stringify(keys)}`,
    );
  }

  // Important for secure cookies behind proxy: req.secure depends on trust proxy
  if (typeof app.set === 'function') {
    app.set('trust proxy', 1);
  }

  return app;
}

async function withRealServer(fn) {
  // Ensure env even if someone calls loadExpressApp() differently later
  ensureTestDbEnv();

  const app = await loadExpressApp();

  // Listen on random free port to avoid EADDRINUSE
  const srv = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const { port } = srv.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const ctx = {
    baseUrl,
    // Send as if behind HTTPS proxy → secure cookies allowed
    headers: { 'X-Forwarded-Proto': 'https' },
  };

  try {
    await fn(ctx);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
}

module.exports = { withRealServer };
