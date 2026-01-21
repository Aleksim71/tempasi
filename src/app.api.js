import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function isRouterLike(v) {
  return typeof v === 'function' && v && typeof v.use === 'function' && v.handle;
}

function isFactoryLike(fn) {
  return typeof fn === 'function' && !isRouterLike(fn);
}

function tryBuildRouterFromFactory(fn) {
  const attempts = [() => fn(), () => fn({})];

  for (const attempt of attempts) {
    try {
      const out = attempt();
      if (isRouterLike(out)) return out;
    } catch {
      // ignore and continue
    }
  }
  return null;
}

function normalizeRouterExport(mod, preferredKeys = []) {
  if (!mod) return null;

  if (isRouterLike(mod)) return mod;

  if (mod.default) {
    const r = normalizeRouterExport(mod.default, preferredKeys);
    if (r) return r;
  }

  for (const k of preferredKeys) {
    if (!mod[k]) continue;
    const v = mod[k];

    if (isRouterLike(v)) return v;
    if (v?.default && isRouterLike(v.default)) return v.default;

    if (isFactoryLike(v)) {
      const r = tryBuildRouterFromFactory(v);
      if (r) return r;
    }
    if (v?.default && isFactoryLike(v.default)) {
      const r = tryBuildRouterFromFactory(v.default);
      if (r) return r;
    }
  }

  for (const k of Object.keys(mod)) {
    const v = mod[k];

    if (isRouterLike(v)) return v;
    if (v?.default && isRouterLike(v.default)) return v.default;

    if (isFactoryLike(v)) {
      const r = tryBuildRouterFromFactory(v);
      if (r) return r;
    }
    if (v?.default && isFactoryLike(v.default)) {
      const r = tryBuildRouterFromFactory(v.default);
      if (r) return r;
    }
  }

  return null;
}

function reqRouter(relPath, preferredKeys) {
  const mod = require(relPath);
  const router = normalizeRouterExport(mod, preferredKeys);

  if (!router) {
    const keys = Object.keys(mod || {});
    throw new Error(`[api] Router not found in ${relPath}. Exports: ${keys.join(', ')}`);
  }

  return router;
}

function isProd() {
  return process.env.NODE_ENV === 'production';
}

export function createApiApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/__health', (req, res) => res.json({ ok: true }));

  // Known routers
  app.use('/auth', reqRouter('./modules/auth/auth.routes.cjs', ['authRouter', 'router']));
  app.use(
    '/orders',
    reqRouter('./modules/orders/orders.routes.cjs', ['ordersApiRoutes', 'ordersRoutes', 'router']),
  );
  app.use(
    '/payments',
    reqRouter('./modules/payments/payments.routes.cjs', [
      'paymentsApiRoutes',
      'paymentsRoutes',
      'router',
    ]),
  );
  app.use(
    '/downloads',
    reqRouter('./modules/downloads/downloads.routes.cjs', ['downloadsRoutes', 'router']),
  );
  app.use(
    '/profile',
    reqRouter('./modules/profile/profile.api.routes.cjs', ['profileApiRoutes', 'router']),
  );

  // 404 JSON
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path });
  });

  // error handler JSON (dev-friendly)
   
  app.use((err, req, res, next) => {
    console.error('[api] error:', err?.stack || err);

    const status = Number.isInteger(err?.status) ? err.status : 500;

    // Postgres errors often have: code, detail, hint, constraint, table, column
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

    if (!isProd()) {
      return res.status(status).json({
        error: 'Internal Server Error',
        message: String(err?.message || err || 'Error'),
        status,
        ...pg,
      });
    }

    return res
      .status(status)
      .json({ error: status === 500 ? 'Internal Server Error' : String(err?.message || 'Error') });
  });

  return app;
}
