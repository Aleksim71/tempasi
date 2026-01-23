// src/app.js
// ESM (src/server.js: import app from './app.js')
//
// FIX: Use the real ESM SSR web app bootstrap (createWebApp) so Handlebars is configured,
// instead of mounting the router without a view engine.
// Keeps debug toggles:
//   TEMPASI_SKIP_AUTH=1  -> skip initAuth middleware
//   TEMPASI_SKIP_SSR=1   -> enable SSR stub (templates ok text)

import express from 'express';
import { createRequire } from 'module';

import { requestWatchdog } from './web/middleware/request-watchdog.js';
import { createWebApp } from './app.web.js';

const require = createRequire(import.meta.url);

// ---- AUTH middleware (CJS) ----
const { initAuth } = require('./middlewares/auth.middleware.cjs');

// ---- ROUTERS (CJS) ----
const authMod = require('./modules/auth/auth.routes.cjs');
const ordersMod = require('./modules/orders/orders.routes.cjs');
const downloadsMod = require('./modules/downloads/downloads.routes.cjs');

// ВАЖНО: эти два файла разные!
const profilePagesMod = require('./modules/profile/profile.routes.cjs'); // pages (/profile/..)
const profileApiMod = require('./modules/profile/profile.api.routes.cjs'); // api (/api/profile/..)

// ---- helpers ----
function pickRouter(mod, keys, label = 'router') {
  if (typeof mod === 'function') return mod;

  if (mod && typeof mod === 'object') {
    for (const k of keys) {
      if (typeof mod[k] === 'function') return mod[k];
    }
    if (typeof mod.router === 'function') return mod.router;
    if (mod.default && typeof mod.default === 'function') return mod.default;
  }

  const got = mod && typeof mod === 'object' ? Object.keys(mod) : [];
  throw new Error(`[app.js] Cannot resolve ${label} export. keys=${JSON.stringify(got)}`);
}

// ---- resolved routers ----
const authRouter = pickRouter(
  authMod,
  ['authRouter', 'authRoutes', 'router', 'routes'],
  'auth router',
);
const ordersRouter = pickRouter(
  ordersMod,
  ['ordersRouter', 'ordersRoutes', 'router', 'routes'],
  'orders router',
);
const downloadsRouter = pickRouter(
  downloadsMod,
  ['downloadsRouter', 'downloadsRoutes', 'router', 'routes'],
  'downloads router',
);

const profileRouter = pickRouter(
  profilePagesMod,
  ['profileRouter', 'profileRoutes', 'router', 'routes'],
  'profile pages router',
);

const profileApiRouter = pickRouter(
  profileApiMod,
  ['profileApiRouter', 'profileApiRoutes', 'router', 'routes'],
  'profile api router',
);

function makeSsrStubRouter() {
  const r = express.Router();
  r.get('/templates', (_req, res) => res.status(200).type('text').send('Templates OK (SSR stub)'));
  r.get('/templates/:slug', (_req, res) =>
    res.status(200).type('text').send('Template OK (SSR stub)'),
  );
  r.get('/preview/:slug', (_req, res) =>
    res.status(200).type('text').send('Preview OK (SSR stub)'),
  );
  r.get('/__debug/routes2', (_req, res) =>
    res.status(200).json({ ok: true, note: 'SSR stub enabled (TEMPASI_SKIP_SSR=1)' }),
  );
  return r;
}

export function createApp({ db } = {}) {
  const app = express();

  if (db) app.locals.db = db;

  // 🔎 Watchdog FIRST: catch hangs anywhere
  app.use(requestWatchdog({ timeoutMs: 3000, hardFail: false }));

  // Boundary log (helps see if we even enter the chain)
  app.use((req, _res, next) => {
     
    console.log(`[APP] enter: ${req.method} ${req.originalUrl || req.url}`);
    next();
  });

  // middleware
  app.use(express.urlencoded({ extended: false })); // HTML forms
  app.use(express.json({ limit: '1mb' })); // API JSON

  // cookie-session auth -> req.user + res.locals.user
  if (process.env.TEMPASI_SKIP_AUTH === '1') {
     
    console.warn('[app.js] TEMPASI_SKIP_AUTH=1 -> auth middleware skipped');
  } else {
    app.use((req, res, next) => {
       
      console.log(`[APP] auth: before initAuth ${req.method} ${req.originalUrl || req.url}`);
      return initAuth(req, res, next);
    });
  }

  // health
  app.get('/__health', (_req, res) => res.status(200).json({ ok: true }));

  // root convenience
  app.get('/', (_req, res) => res.redirect('/templates'));

  // ---------- API ----------
  app.use('/api/auth', authRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/profile', profileApiRouter);

  // ---------- Downloads ----------
  app.use('/download', downloadsRouter);

  // ---------- SSR ----------
  app.use('/profile', profileRouter);

  const skipSSR = process.env.TEMPASI_SKIP_SSR === '1' || process.env.NODE_ENV === 'test';
  if (skipSSR) {
     
    console.warn('[app.js] SSR stub enabled (TEMPASI_SKIP_SSR=1 or NODE_ENV=test)');
    app.use('/', makeSsrStubRouter());
  } else {
    // ✅ IMPORTANT: configure Handlebars + partials + static + mount web routes
     
    console.log('[app.js] SSR: createWebApp() bootstrap');
    createWebApp(app);
  }

  // ---------- 404 ----------
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Not Found' },
      });
    }
    return res.status(404).type('text').send('404 Not Found');
  });

  // ---------- Error handler ----------
   
  app.use((err, req, res, _next) => {
    const status = err.status || 500;

     
    console.error('[app.js] error handler:', err);

    if (req.path.startsWith('/api/')) {
      return res.status(status).json({
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'Internal Error',
        },
      });
    }

    return res
      .status(status)
      .type('text')
      .send(err.message || 'Internal Error');
  });

  return app;
}

// server.js expects default export
const app = createApp();
export default app;
