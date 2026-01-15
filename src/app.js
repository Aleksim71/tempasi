// src/app.js
import express from 'express';
import { createWebApp } from './app.web.js';

function isMiddleware(x) {
  return typeof x === 'function' || (x && typeof x.handle === 'function');
}

function safeUse(app, base, handler, label) {
  if (!isMiddleware(handler)) {
    console.warn(`[app] skip mount ${label}: not a middleware`);
    return;
  }
  if (base) app.use(base, handler);
  else app.use(handler);
  console.log(`[app] mounted ${label}${base ? ` at ${base}` : ''}`);
}

async function tryImportCjs(relPathFromRoot) {
  try {
    // ESM-import CJS через абсолютный путь:
    const { pathToFileURL } = await import('node:url');
    const { default: path } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const ROOT_DIR = path.resolve(__dirname, '..');

    const abs = path.join(ROOT_DIR, relPathFromRoot);
    const mod = await import(pathToFileURL(abs).href);
    return mod;
  } catch (e) {
    return null;
  }
}

export async function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // WEB
  await createWebApp(app);

  // API (монтируем только если реально есть middleware)
  const candidates = [
    { label: 'orders.routes', base: '/api/orders', rel: 'src/modules/orders/orders.routes.cjs' },
    {
      label: 'payments.routes',
      base: '/api/payments',
      rel: 'src/modules/payments/payments.routes.cjs',
    },
    {
      label: 'profile.routes',
      base: '/api/profile',
      rel: 'src/modules/profile/profile.routes.cjs',
    },
  ];

  for (const c of candidates) {
    const mod = await tryImportCjs(c.rel);
    if (!mod) continue;

    // поддержим варианты экспортов:
    // - module.exports = router
    // - exports.profileRoutes = () => router
    // - exports.routes = router
    let handler = mod?.default ?? mod?.routes ?? null;

    if (!handler && typeof mod?.profileRoutes === 'function') handler = mod.profileRoutes();
    if (!handler && typeof mod?.ordersRoutes === 'function') handler = mod.ordersRoutes();
    if (!handler && typeof mod?.paymentsRoutes === 'function') handler = mod.paymentsRoutes();

    safeUse(app, c.base, handler, c.label);
  }

  // 404
  app.use((req, res) => res.status(404).type('text').send('Not found'));

  // !!! ВАЖНО: error handler, чтобы сервер НЕ ПАДАЛ от ошибок в роутах
  // Express 5 умеет ловить async-ошибки, но этот хендлер обязателен всё равно.
  app.use((err, req, res, next) => {
    console.error('[app] error:', err);

    if (res.headersSent) return next(err);

    const accept = String(req.headers.accept || '');
    if (accept.includes('text/html')) {
      return res.status(500).type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>500</title></head>
<body style="font-family:system-ui,Arial,sans-serif;padding:24px">
  <h1>500</h1>
  <pre style="white-space:pre-wrap">${String(err?.stack || err)}</pre>
  <p><a href="/templates">Back to templates</a></p>
</body></html>`);
    }

    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
