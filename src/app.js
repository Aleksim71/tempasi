// src/app.js
// ESM (src/server.js: import app from './app.js')
//
// Debug toggles:
//   TEMPASI_SKIP_AUTH=1      -> skip initAuth middleware
//   TEMPASI_SKIP_SSR=1       -> enable SSR stub (templates ok text)
//   TEMPASI_SKIP_WATCHDOG=1  -> disable requestWatchdog

import express from 'express';
import { createRequire } from 'module';

import { requestWatchdog } from './web/middleware/request-watchdog.js';
import { createWebApp } from './app.web.js';

const require = createRequire(import.meta.url);

// --------------------
// DB (CJS)
// --------------------
const dbMod = require('./config/db.cjs');

/**
 * Normalize anything exported by db.cjs to a Pool/Client-like object
 * that has `.query(sql, params)`.
 *
 * Common export shapes we handle:
 * - module.exports = pool
 * - module.exports = { pool }
 * - module.exports = { db }
 * - module.exports = { POOL }
 * - module.exports = { default: pool }
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
const ordersMod = require('./modules/orders/orders.routes.cjs');
const downloadsMod = require('./modules/downloads/downloads.routes.cjs');

// Pages SSR router + API router
const profilePagesMod = require('./modules/profile/profile.routes.cjs'); // pages (/profile/..)
const profileApiMod = require('./modules/profile/profile.api.routes.cjs'); // api (/api/profile/..)

// --------------------
// helpers
// --------------------
function isMiddlewareFn(fn) {
  // (req,res,next) or (err,req,res,next)
  return typeof fn === 'function' && fn.length >= 3;
}

function isRouterLike(x) {
  // express.Router() is a callable function with .use/.get/etc
  return typeof x === 'function' && typeof x.use === 'function';
}

function unwrapRouterishObject(obj, ctx) {
  if (!obj || typeof obj !== 'object') return null;

  // common keys that might contain router or factory
  const keys = ['router', 'routes', 'middleware', 'handler', 'default'];
  for (const k of keys) {
    const v = obj[k];
    const picked = callAsFactory(v, ctx);
    if (picked) return picked;
  }

  // sometimes export shape is { profileRoutes: { router: ... } } etc.
  // If object itself is already router-like (rare), accept it.
  if (isRouterLike(obj) || isMiddlewareFn(obj)) return obj;

  return null;
}

function callAsFactory(maybeFn, ctx) {
  if (!maybeFn) return null;

  // 1) already router/middleware
  if (isRouterLike(maybeFn) || isMiddlewareFn(maybeFn)) return maybeFn;

  // 2) object wrapper that contains router/factory
  if (typeof maybeFn === 'object') {
    const unwrapped = unwrapRouterishObject(maybeFn, ctx);
    if (unwrapped) return unwrapped;
    return null;
  }

  // 3) factory case: fn({db}) → router
  if (typeof maybeFn === 'function') {
    try {
      const produced = maybeFn(ctx);
      if (isRouterLike(produced) || isMiddlewareFn(produced)) return produced;

      if (produced && typeof produced === 'object') {
        const unwrapped = unwrapRouterishObject(produced, ctx);
        if (unwrapped) return unwrapped;
      }
    } catch (_e) {
      // continue
    }

    // 4) factory expects db directly: fn(db) → router
    try {
      const produced2 = maybeFn(ctx.db);
      if (isRouterLike(produced2) || isMiddlewareFn(produced2)) return produced2;

      if (produced2 && typeof produced2 === 'object') {
        const unwrapped2 = unwrapRouterishObject(produced2, ctx);
        if (unwrapped2) return unwrapped2;
      }
    } catch (_e) {
      // continue
    }
  }

  return null;
}

function pickRouter(mod, keys, label = 'router', ctx = { db }) {
  // module itself can be router/middleware or factory
  const direct = callAsFactory(mod, ctx);
  if (direct) return direct;

  if (mod && typeof mod === 'object') {
    // first: declared keys (preferred)
    for (const k of keys) {
      const picked = callAsFactory(mod[k], ctx);
      if (picked) return picked;
    }

    // then: conventional names
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

  // already middleware/router
  if (isMiddlewareFn(maybeInitAuth) || isRouterLike(maybeInitAuth)) return maybeInitAuth;

  // factory: () => middleware/router or () => { middleware }
  try {
    const produced = maybeInitAuth();
    if (isMiddlewareFn(produced) || isRouterLike(produced)) return produced;

    if (produced && typeof produced === 'object') {
      if (isMiddlewareFn(produced.middleware) || isRouterLike(produced.middleware))
        return produced.middleware;
      if (isMiddlewareFn(produced.auth) || isRouterLike(produced.auth)) return produced.auth;
      if (isMiddlewareFn(produced.router) || isRouterLike(produced.router)) return produced.router;
    }
  } catch (_e) {
    // ignore
  }

  return null;
}

function attachDb(dbInstance) {
  // ensure dbInstance always has query
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
  return r;
}

// --------------------
// app bootstrap
// --------------------
const app = express();

// health first
app.get('/__health', (_req, res) => res.status(200).json({ ok: true }));

// watchdog (non-blocking)
if (!process.env.TEMPASI_SKIP_WATCHDOG) {
  app.use(requestWatchdog);
}

// ✅ DB MUST BE AVAILABLE BEFORE AUTH
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

// ---- resolved API routers (ctx: {db}) ----
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

// APIs under strict prefixes (so nothing can shadow SSR pages)
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/downloads', downloadsRouter);
app.use('/api/profile', profileApiRouter);

// SSR (or stub) LAST
if (process.env.TEMPASI_SKIP_SSR) {
  app.use(makeSsrStubRouter());
} else {
  const webApp = createWebApp({ db });

  // Cabinet placeholder
  webApp.get('/cabinet', (_req, res) => {
    res.status(200).type('text').send('Cabinet OK (WIP)');
  });

  // ---- resolved SSR pages router (ctx: {db, webApp}) ----
  const profileRouter = pickRouter(
    profilePagesMod,
    ['profileRouter', 'profileRoutes', 'router', 'routes'],
    'profile pages router',
    { db, webApp },
  );

  // mount pages router inside webApp
  webApp.use(profileRouter);

  app.use(webApp);
}

export default app;
