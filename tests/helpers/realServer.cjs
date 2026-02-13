// tests/helpers/realServer.cjs
/* eslint-env node */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

async function loadExpressApp() {
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
  const app = await loadExpressApp();

  // Listen on random free port to avoid EADDRINUSE:3000
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
