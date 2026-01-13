// src/app.js
// ESM (src/server.js: import app from './app.js')

import path from 'path';
import fs from 'fs';
import express from 'express';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- AUTH middleware (CJS) ----
const { initAuth } = require('./middlewares/auth.middleware.cjs');

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

function tryRequireFirst(candidates) {
  const tried = [];
  for (const rel of candidates) {
    tried.push(rel);
    try {
      return { mod: require(rel), picked: rel };
    } catch (e) {
      if (
        e &&
        (e.code === 'MODULE_NOT_FOUND' || String(e.message || '').includes('Cannot find module'))
      ) {
        continue;
      }
      throw e;
    }
  }

  const webDir = path.join(__dirname, 'web');
  let webFiles = [];
  try {
    webFiles = fs.readdirSync(webDir);
  } catch (_) {}

  const msg =
    `[app.js] Cannot find SSR web router module. Tried: ${tried.join(', ')}. ` +
    (webFiles.length
      ? `Files in src/web: ${webFiles.join(', ')}`
      : `src/web not readable or empty`);

  throw new Error(msg);
}

// ---- ROUTERS (CJS) ----
const authMod = require('./modules/auth/auth.routes.cjs');
const ordersMod = require('./modules/orders/orders.routes.cjs');
const downloadsMod = require('./modules/downloads/downloads.routes.cjs');

// ВАЖНО: эти два файла разные!
const profilePagesMod = require('./modules/profile/profile.routes.cjs'); // pages (/profile/..)
const profileApiMod = require('./modules/profile/profile.api.routes.cjs'); // api (/api/profile/..)

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

// SSR web router is optional in tests
function resolveWebRouterOrFallback() {
  const isTest = process.env.NODE_ENV === 'test' || process.env.TEMPASI_SKIP_SSR === '1';
  if (isTest) {
    const r = express.Router();
    // Минимальный SSR stub: чтобы /templates отвечал (и не зависал на DB/SSR)
    r.get('/templates', (_req, res) =>
      res.status(200).type('text').send('Templates OK (SSR stub)'),
    );
    r.get('/templates/:slug', (_req, res) =>
      res.status(200).type('text').send('Template OK (SSR stub)'),
    );
    r.get('/preview/:slug', (_req, res) =>
      res.status(200).type('text').send('Preview OK (SSR stub)'),
    );
    return r;
  }

  const { mod: webMod } = tryRequireFirst([
    './web/web.routes.cjs',
    './web/web.routes.js',
    './web/routes.cjs',
    './web/routes.js',
    './web/router.cjs',
    './web/router.js',
    './web/index.cjs',
    './web/index.js',
    './web/app.cjs',
    './web/app.js',
  ]);

  return pickRouter(webMod, ['webRouter', 'webRoutes', 'router', 'routes'], 'web (SSR) router');
}

const webRouter = resolveWebRouterOrFallback();

export function createApp({ db } = {}) {
  const app = express();

  if (db) app.locals.db = db;

  // views (не мешает тестам, но и не обязательны)
  app.set('views', path.join(__dirname, 'web', 'views'));
  app.set('view engine', 'hbs');

  // middleware
  app.use(express.urlencoded({ extended: false })); // HTML forms
  app.use(express.json({ limit: '1mb' })); // API JSON

  // cookie-session auth -> req.user + res.locals.user
  app.use(initAuth);

  // static
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // health (для тестов/ожидания старта сервера)
  app.get('/__health', (_req, res) => res.status(200).json({ ok: true }));

  // ---------- API ----------
  app.use('/api/auth', authRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/profile', profileApiRouter);

  // ---------- Downloads ----------
  app.use('/download', downloadsRouter);

  // ---------- SSR ----------
  app.use('/profile', profileRouter);

  // root convenience
  app.get('/', (_req, res) => res.redirect('/templates'));

  // main SSR website (optional in tests)
  app.use('/', webRouter);

  // ---------- 404 ----------
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Not Found' },
      });
    }
    return res.status(404).send('404 Not Found');
  });

  // ---------- Error handler ----------
   
  app.use((err, req, res, _next) => {
    const status = err.status || 500;

    if (req.path.startsWith('/api/')) {
      return res.status(status).json({
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'Internal Error',
        },
      });
    }

    return res.status(status).send(err.message || 'Internal Error');
  });

  return app;
}

// server.js expects default export
const app = createApp();
export default app;
