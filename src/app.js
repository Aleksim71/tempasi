// src/app.js
// ESM (src/server.js: import app from './app.js')
//
// Debug toggles:
//   TEMPASI_SKIP_AUTH=1      -> skip initAuth middleware
//   TEMPASI_SKIP_SSR=1       -> enable SSR stub (templates ok text)
//   TEMPASI_SKIP_WATCHDOG=1  -> disable requestWatchdog
//   TEMPASI_LOG_REQ=1        -> log req/res for debugging
//
// Watchdog env:
//   TEMPASI_WATCHDOG_MS=2500

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

import { requestWatchdog } from './web/middleware/request-watchdog.js';
import { createWebApp } from './app.web.js';
import { requireAuthWeb } from './web/middleware/require-auth.web.js';

const require = createRequire(import.meta.url);

// --------------------
// paths
// --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// app.js is in /src → project root is ..
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

// --------------------
// IMPORTANT: test DB wiring
// --------------------
// In tests we run migrations against DATABASE_URL_TEST.
// Make the running server also point to the same DB.
if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL_TEST) {
  // Prefer DATABASE_URL in db.cjs resolution (avoid PG* picking dev DB)
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

  // Optional: neutralize PG* if present (safer)
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGUSER;
  delete process.env.PGDATABASE;
  delete process.env.PGPASSWORD;
}

// --------------------
// DB (CJS)
// --------------------
const dbMod = require('./config/db.cjs');

/**
 * Normalize anything exported by db.cjs to a Pool/Client-like object
 * that has `.query(sql, params)`.
 */
function normalizeDb(m) {
  const candidates = [
    m,
    m && m.pool,
    m && m.db,
    m && m.POOL,
    m && m.default,
    m && m.default && m.default.pool,
    m && m.default && m.default.db,
  ].filter(Boolean);

  for (const c of candidates) {
    if (c && typeof c.query === 'function') return c;
  }

  const keys = m && typeof m === 'object' ? Object.keys(m) : [];
  throw new Error(
    `[app.js] Cannot resolve db instance with .query(). keys=${JSON.stringify(keys)}`,
  );
}

const db = normalizeDb(dbMod);

// --------------------
// AUTH middleware (CJS)
// --------------------
const { initAuth } = require('./middlewares/auth.middleware.cjs');

// --------------------
// ROUTERS (CJS)
// --------------------
const authMod = require('./modules/auth/auth.routes.cjs');
const passwordResetMod = require('./modules/auth/passwordReset.routes.cjs');
const ordersMod = require('./modules/orders/orders.routes.cjs');
const downloadsMod = require('./modules/downloads/downloads.routes.cjs');

// Pages SSR router + API router
const profilePagesMod = require('./modules/profile/profile.routes.cjs'); // pages (/profile/..)
const profileApiMod = require('./modules/profile/profile.api.routes.cjs'); // api (/api/profile/..)

// Cabinet pages router (CJS)
const { createCabinetPagesRouter } = require('./web/routes/cabinet.pages.routes.cjs');

// --------------------
// helpers
// --------------------
function isMiddlewareFn(fn) {
  return typeof fn === 'function' && fn.length >= 3;
}

function isRouterLike(x) {
  return typeof x === 'function' && typeof x.use === 'function';
}

function unwrapRouterishObject(obj, ctx) {
  if (!obj || typeof obj !== 'object') return null;

  const keys = ['router', 'routes', 'middleware', 'handler', 'default'];
  for (const k of keys) {
    const v = obj[k];
    const picked = callAsFactory(v, ctx);
    if (picked) return picked;
  }

  if (isRouterLike(obj) || isMiddlewareFn(obj)) return obj;
  return null;
}

function callAsFactory(maybeFn, ctx) {
  if (!maybeFn) return null;

  if (isRouterLike(maybeFn) || isMiddlewareFn(maybeFn)) return maybeFn;

  if (typeof maybeFn === 'object') {
    const unwrapped = unwrapRouterishObject(maybeFn, ctx);
    if (unwrapped) return unwrapped;
    return null;
  }

  if (typeof maybeFn === 'function') {
    try {
      const produced = maybeFn(ctx);
      if (isRouterLike(produced) || isMiddlewareFn(produced)) return produced;
      if (produced && typeof produced === 'object') {
        const unwrapped = unwrapRouterishObject(produced, ctx);
        if (unwrapped) return unwrapped;
      }
    } catch (_e) {}

    try {
      const produced2 = maybeFn(ctx.db);
      if (isRouterLike(produced2) || isMiddlewareFn(produced2)) return produced2;
      if (produced2 && typeof produced2 === 'object') {
        const unwrapped2 = unwrapRouterishObject(produced2, ctx);
        if (unwrapped2) return unwrapped2;
      }
    } catch (_e) {}
  }

  return null;
}

function pickRouter(mod, keys, label = 'router', ctx = { db }) {
  const direct = callAsFactory(mod, ctx);
  if (direct) return direct;

  if (mod && typeof mod === 'object') {
    for (const k of keys) {
      const picked = callAsFactory(mod[k], ctx);
      if (picked) return picked;
    }
    for (const k of ['router', 'routes', 'default', 'middleware', 'handler']) {
      const picked = callAsFactory(mod[k], ctx);
      if (picked) return picked;
    }
  }

  const got = mod && typeof mod === 'object' ? Object.keys(mod) : [];
  throw new Error(`[app.js] Cannot resolve ${label} export. keys=${JSON.stringify(got)}`);
}

function resolveAuthMiddleware(maybeInitAuth) {
  if (typeof maybeInitAuth !== 'function') return null;

  if (isMiddlewareFn(maybeInitAuth) || isRouterLike(maybeInitAuth)) return maybeInitAuth;

  try {
    const produced = maybeInitAuth();
    if (isMiddlewareFn(produced) || isRouterLike(produced)) return produced;

    if (produced && typeof produced === 'object') {
      if (isMiddlewareFn(produced.middleware) || isRouterLike(produced.middleware))
        return produced.middleware;
      if (isMiddlewareFn(produced.auth) || isRouterLike(produced.auth)) return produced.auth;
      if (isMiddlewareFn(produced.router) || isRouterLike(produced.router)) return produced.router;
    }
  } catch (_e) {}

  return null;
}

function attachDb(dbInstance) {
  const normalized = normalizeDb(dbInstance);
  return (req, _res, next) => {
    req.db = normalized;
    next();
  };
}

function makeSsrStubRouter() {
  const r = express.Router();
  r.get('/templates', (_req, res) => res.status(200).type('text').send('Templates OK (SSR stub)'));
  r.get('/templates/:slug', (_req, res) =>
    res.status(200).type('text').send('Template OK (SSR stub)'),
  );
  r.get('/cabinet', (_req, res) => res.status(200).type('text').send('Cabinet OK (SSR stub)'));
  r.get('/profile', (_req, res) => res.status(200).type('text').send('Profile OK (SSR stub)'));
  return r;
}

// --------------------
// app bootstrap
// --------------------
const app = express();

// ultra-early request logger (optional)
if (process.env.TEMPASI_LOG_REQ) {
  app.use((req, res, next) => {
    console.log('[REQ]', req.method, req.url);
    res.on('finish', () => console.log('[RES]', req.method, req.url, res.statusCode));
    next();
  });
}

// health first
app.get('/__health', (_req, res) => res.status(200).json({ ok: true }));

// static MUST be before any auth/watchdog/SSR
app.use('/css', express.static(path.join(publicDir, 'css'), { fallthrough: false }));
app.use('/icons', express.static(path.join(publicDir, 'icons'), { fallthrough: false }));
app.use(express.static(publicDir, { fallthrough: true }));

// ✅ API body parsing (tests send JSON)
app.use('/api', express.json({ limit: '1mb' }));
app.use('/api', express.urlencoded({ extended: false }));

// DB available before auth/routers
app.use(attachDb(db));

// auth (optional)
if (!process.env.TEMPASI_SKIP_AUTH) {
  const authMw = resolveAuthMiddleware(initAuth);
  if (!authMw) {
    throw new Error(
      '[app.js] initAuth resolved to non-middleware. Check auth.middleware.cjs exports.',
    );
  }
  app.use(authMw);
}

// watchdog — ONLY for API + downloads (never for SSR pages)
if (!process.env.TEMPASI_SKIP_WATCHDOG) {
  app.use('/api', requestWatchdog);
  app.use('/downloads', requestWatchdog);
}

// ---- resolved API routers (ctx: {db}) ----
const passwordResetRouter = pickRouter(
  passwordResetMod,
  ['passwordResetRouter', 'passwordResetRoutes', 'router', 'routes'],
  'password reset router',
  { db },
);

const authRouter = pickRouter(
  authMod,
  ['authRouter', 'authRoutes', 'router', 'routes'],
  'auth router',
  { db },
);

const ordersRouter = pickRouter(
  ordersMod,
  ['ordersRouter', 'ordersRoutes', 'router', 'routes'],
  'orders router',
  { db },
);

const downloadsRouter = pickRouter(
  downloadsMod,
  ['downloadsRouter', 'downloadsRoutes', 'router', 'routes'],
  'downloads router',
  { db },
);

const profileApiRouter = pickRouter(
  profileApiMod,
  ['profileApiRouter', 'profileApiRoutes', 'router', 'routes'],
  'profile api router',
  { db },
);

// APIs under strict prefixes
app.use('/api/auth', passwordResetRouter);
app.use('/api/auth', authRouter);

app.use('/api/orders', ordersRouter);
app.use('/downloads', downloadsRouter);
app.use('/api/profile', profileApiRouter);

// SSR (or stub) LAST
if (process.env.TEMPASI_SKIP_SSR) {
  app.use(makeSsrStubRouter());
} else {
  const webApp = createWebApp({ db });

  // ✅ Protect Cabinet (Overview + Cases) via ONE router mounted under /cabinet
  webApp.use(
    '/cabinet',
    requireAuthWeb({ loginPath: '/login', defaultNext: '/cabinet' }),
    createCabinetPagesRouter({ db }),
  );

  // ✅ Protect Profile pages
  const profileRouter = pickRouter(
    profilePagesMod,
    ['profileRouter', 'profileRoutes', 'router', 'routes'],
    'profile pages router',
    { db, webApp },
  );

  webApp.use(
    '/profile',
    requireAuthWeb({ loginPath: '/login', defaultNext: '/profile' }),
    profileRouter,
  );

  app.use(webApp);
}

export default app;
