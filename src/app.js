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

// ---- DB (CJS) ----
const dbMod = require('./config/db.cjs');
const db = (dbMod && (dbMod.db || dbMod.pool || dbMod.POOL)) || dbMod;

// ---- AUTH middleware (CJS) ----
const { initAuth } = require('./middlewares/auth.middleware.cjs');

// ---- ROUTERS (CJS) ----
const authMod = require('./modules/auth/auth.routes.cjs');
const ordersMod = require('./modules/orders/orders.routes.cjs');
const downloadsMod = require('./modules/downloads/downloads.routes.cjs');

// Pages SSR router + API router
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

function resolveAuthMiddleware(maybeInitAuth) {
  if (typeof maybeInitAuth !== 'function') return null;

  // already middleware: (req,res,next) or (err,req,res,next)
  if (maybeInitAuth.length >= 3) return maybeInitAuth;

  // factory: () => middleware
  const produced = maybeInitAuth();
  if (typeof produced === 'function') return produced;

  return produced;
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
  r.get('/cabinet', (_req, res) => res.status(200).type('text').send('Cabinet OK (SSR stub)'));
  return r;
}

// ---- app bootstrap ----
const app = express();

// health first
app.get('/__health', (_req, res) => res.status(200).json({ ok: true }));

// watchdog (SAFE wrapper: cannot block the chain)
if (!process.env.TEMPASI_SKIP_WATCHDOG) {
  app.use((req, res, next) => {
    next();
    setImmediate(() => {
      try {
        requestWatchdog(req, res, () => {});
      } catch {
        // ignore completely
      }
    });
  });
}

// auth (optional)
if (!process.env.TEMPASI_SKIP_AUTH) {
  const authMw = resolveAuthMiddleware(initAuth);
  if (typeof authMw === 'function') app.use(authMw);
}

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

  // Cabinet: empty SSR page (HBS)
  webApp.get('/cabinet', (_req, res) => {
    res.status(200).render('pages/cabinet', {
      title: 'Cabinet',
      page: 'cabinet',
      pageCss: ['pages/cabinet.css'],
    });
  });

  // mount SSR pages router inside webApp
  webApp.use(profileRouter);

  app.use(webApp);
}

export default app;
