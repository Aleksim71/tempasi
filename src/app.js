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
import { requireAdminWeb } from './web/middleware/require-admin.web.js';
import checkoutRouter from './web/routes/checkout.routes.js';
import { createPreviewProxyRouter } from './web/routes/preview-proxy.routes.js';

const require = createRequire(import.meta.url);
const { renderStandalonePage } = require('./web/helpers/renderStandalonePage.cjs');

function escapeHtmlForNotFound(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

// Community pages router (CJS)
const { createCommunityPagesRouter } = require('./web/routes/community.pages.routes.cjs');

// Admin pages router (CJS)
const { createAdminPagesRouter } = require('./web/routes/admin.pages.routes.cjs');

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

function isPublicCasePreviewRequest(req) {
  if (!req || String(req.method || '').toUpperCase() !== 'GET') return false;
  const originalUrl = String(req.originalUrl || req.url || '');
  const pathname = originalUrl.split('?')[0];
  return /^\/cabinet\/cases\/[^/]+\/preview\/public\/?$/.test(pathname);
}

function requireCabinetAuthExceptPublicCasePreview(options) {
  const requireAuth = requireAuthWeb(options);

  return function cabinetAuthGate(req, res, next) {
    if (isPublicCasePreviewRequest(req)) return next();
    return requireAuth(req, res, next);
  };
}

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

// TEMPASI_API_JSON_ERROR_HANDLER (2026-08-11)
// Previously /api/* routes had no error-handling middleware of their
// own in this file (unlike app.api.js, which is a separate Express
// app not actually mounted for the running server). An unhandled
// error thrown by any /api/* route (e.g. a Postgres unique-constraint
// violation) fell through to Express's built-in default handler,
// which returns an HTML error page — not JSON. Client-side fetch()
// callers doing `await response.json()` would then throw trying to
// parse HTML as JSON, landing in their generic catch block and
// showing a misleading "Network error." even though the real cause
// was an ordinary validation failure (e.g. "nickname already taken").
// Scoped to '/api' only, mounted before the SSR/webApp fallback, so
// page rendering and its own error handling are untouched.
app.use('/api', (err, req, res, next) => {
  console.error('[api] error:', err?.stack || err);

  const status = Number.isInteger(err?.status) ? err.status : 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Postgres errors carry: code, detail, hint, constraint, table, column
  const pg =
    err && typeof err === 'object'
      ? {
          code: err.code,
          detail: err.detail,
          hint: err.hint,
          constraint: err.constraint,
          table: err.table,
          column: err.column,
        }
      : {};

  if (!isProd) {
    return res.status(status).json({
      ok: false,
      error: 'Internal Server Error',
      message: String(err?.message || err || 'Error'),
      status,
      ...pg,
    });
  }

  // In production, still surface the message for deliberate 4xx errors
  // (e.g. "this nickname is already taken") — those are safe,
  // user-facing validation text, not internal details. Only 500s stay
  // generic, since those may originate from a raw unhandled exception.
  return res.status(status).json({
    ok: false,
    error: status === 500 ? 'Internal Server Error' : String(err?.message || 'Error'),
    ...(status !== 500 ? { message: String(err?.message || 'Error') } : {}),
  });
});

// SSR (or stub) LAST
if (process.env.TEMPASI_SKIP_SSR) {
  app.use(makeSsrStubRouter());
} else {
  const webApp = createWebApp({ db });

  // ✅ Protect Cabinet pages, but allow tokenized public Case Preview links.
  webApp.use(
    '/cabinet',
    requireCabinetAuthExceptPublicCasePreview({ loginPath: '/login', defaultNext: '/cabinet' }),
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

  // ✅ Protect Community pages (registered users only)
  webApp.use(
    '/community',
    requireAuthWeb({ loginPath: '/login', defaultNext: '/community' }),
    createCommunityPagesRouter({ db }),
  );

  // ✅ Protect Admin pages (role admin/superadmin only)
  webApp.use('/admin', requireAdminWeb({ loginPath: '/login' }), createAdminPagesRouter({ db }));

  webApp.use('/checkout', checkoutRouter);

  // TEMPASI_404_PAGE (2026-08-15)
  // Must be webApp.use(), not app.use() — webApp is a full Express
  // app with its own 'view engine'/'views' settings (set inside
  // createWebApp()), and Express only swaps req.app to point at the
  // currently-executing mounted sub-app while its OWN middleware
  // runs. A catch-all registered on the OUTER app instead would have
  // req.app pointing at that outer app, which never had the view
  // engine configured — res.render() inside it fails with "No
  // default engine was specified" (confirmed by hitting this exact
  // error before moving it here). Must also be the LAST webApp.use()
  // call — registered after every other route webApp gets, so it
  // only catches requests nothing earlier matched.
  webApp.use((req, res) => {
    return renderStandalonePage(req, res, {
      statusCode: 404,
      title: 'Page not found — Tempasi',
      bodyHtml: `
        <h1>404 — Page not found</h1>
        <p>The page <code>${escapeHtmlForNotFound(req.originalUrl)}</code> doesn't exist.</p>
        <p><a class="c-btn c-btn--primary" href="/templates">Back to catalog</a></p>
      `,
    });
  });

  // TEMPASI_PREVIEW_PROXY_PRIORITY (2026-08-05)
  // Mounted on `app` (not `webApp`) and BEFORE `app.use(webApp)`
  // below, so it gets first crack at any /t/* request — taking
  // priority over webApp's own /t/:slug/preview/... and /t/:slug/*
  // routes (which read from TEMPLATE_UPLOAD_DIR, the mount that
  // turned out to have never actually been live). This is the real,
  // working path: an nginx server on the separate storage machine.
  app.use(createPreviewProxyRouter());

  app.use(webApp);
}

export default app;
