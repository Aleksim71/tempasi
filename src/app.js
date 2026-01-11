// src/app.js (ESM)
// Express app for Tempasi (SSR + API routers)
// Exports default app for src/server.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import express from 'express';
import handlebars from 'handlebars';
import { engine } from 'express-handlebars';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================
// App
// =========================
const app = express();

function isDev() {
  return process.env.NODE_ENV !== 'production';
}

// =========================
// Paths
// =========================
const PROJECT_ROOT = process.cwd();
const VIEWS_ROOT = path.join(__dirname, 'web', 'views');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STORAGE_TEMPLATES_DIR = path.resolve(PROJECT_ROOT, 'storage', 'templates');

// =========================
// Helpers (HBS)
// =========================
function toStr(v) {
  return v == null ? '' : String(v);
}

function normalizeLicense(v) {
  const x = toStr(v).trim().toUpperCase();
  return x || 'PU';
}

function normalizeType(v) {
  const x = toStr(v).trim().toLowerCase();
  return x || 'buy';
}

function licenseLabel(license) {
  const v = normalizeLicense(license);
  if (v === 'FREE') return 'FREE';
  if (v === 'EL') return 'EL';
  if (v === 'CU') return 'CU';
  return 'PU';
}

function typeLabel(type) {
  const v = normalizeType(type);
  if (v === 'rent') return 'RENT';
  if (v === 'free') return 'FREE';
  return 'BUY';
}

function formatPriceValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 'Free';
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`;
}

// =========================
// View engine (HBS)
// =========================
const hbs = engine({
  extname: '.hbs',
  layoutsDir: path.join(VIEWS_ROOT, 'layouts'),
  partialsDir: path.join(VIEWS_ROOT, 'partials'),
  defaultLayout: 'main',
  handlebars,
  helpers: {
    eq(a, b) {
      return a === b;
    },
    formatPrice(v) {
      return formatPriceValue(v);
    },
    licenseLabel,
    typeLabel,
    isFree(price) {
      return !price || Number(price) <= 0;
    },
  },
});

app.engine('.hbs', hbs);
app.set('view engine', '.hbs');
app.set('views', path.join(VIEWS_ROOT, 'pages'));

// =========================
// Middleware
// =========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// =========================
// Static
// =========================
app.use(express.static(PUBLIC_DIR));
app.use('/seeds', express.static(STORAGE_TEMPLATES_DIR));
app.use('/t', express.static(STORAGE_TEMPLATES_DIR));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// =========================
// Optional SSR auth attach (best effort)
// =========================
try {
  const authMw = require('./middlewares/auth.middleware.cjs');
  if (typeof authMw === 'function') app.use(authMw);
  else if (authMw && typeof authMw.attachUser === 'function') app.use(authMw.attachUser);
} catch {
  // ignore
}

// =========================
// API routers (CJS via createRequire)
// =========================
try {
  // IMPORTANT: auth.routes exports { authRouter }
  const { authRouter } = require('./modules/auth/auth.routes.cjs');
  const orders = require('./modules/orders/orders.routes.cjs');
  const payments = require('./modules/payments/payments.routes.cjs');
  const downloads = require('./modules/downloads/downloads.routes.cjs');

  app.use('/api/auth', authRouter); // ✅ dev-login + logout
  app.use('/api/orders', orders);
  app.use('/api/payments', payments);
  app.use('/download', downloads);

   
  console.log('[B12] routes mounted: /api/auth, /api/orders, /api/payments, /download');
} catch (e) {
   
  console.error('[B12] mount failed:', e?.message || e);
}

// =========================
// SSR: templates repo
// =========================
let templatesRepo = null;
try {
  templatesRepo = require('./db/templatesRepo.js');
} catch (e) {
   
  console.warn('[SSR] templatesRepo not available:', e?.message || e);
}

async function listTemplates() {
  if (templatesRepo?.listTemplates) return templatesRepo.listTemplates();
  if (templatesRepo?.list) return templatesRepo.list();
  return [];
}

async function getTemplateBySlug(slug) {
  const s = toStr(slug).trim();
  if (!s) return null;
  if (templatesRepo?.getTemplateBySlug) return templatesRepo.getTemplateBySlug(s);
  if (templatesRepo?.getBySlug) return templatesRepo.getBySlug(s);
  const all = await listTemplates();
  return all.find((t) => toStr(t.slug).trim() === s) || null;
}

function mapTemplateForCatalog(t) {
  const slug = toStr(t.slug).trim();
  const hasZip = Boolean(t.hasZip);

  const license = normalizeLicense(t.license);
  const deal =
    license === 'FREE' || normalizeType(t.type) === 'free'
      ? 'FREE'
      : normalizeType(t.type) === 'rent'
        ? 'RENT'
        : 'BUY';

  const previewUrl = slug ? `/seeds/${encodeURIComponent(slug)}/preview/preview.png` : '';

  return {
    ...t,
    slug,
    hasZip,
    deal,
    license,
    type: normalizeType(t.type),
    preview: t.preview || previewUrl,
  };
}

// =========================
// Debug routes (Express 5 note: internal router structure changed)
// We'll keep endpoints, but route listing may be empty.
// =========================
app.get('/__debug/routes2', (req, res) => res.json({ count: 0, routes: [] }));
app.get('/__debug/routes', (req, res) => res.json({ count: 0, routes: [] }));

app.get('/__whoami', (req, res) => {
  const user = req.user || res.locals.user || null;
  res.json({ user });
});

// =========================
// SSR Routes
// =========================
app.get('/', (req, res) => res.redirect('/templates'));

app.get('/templates', async (req, res, next) => {
  try {
    const all = await listTemplates();
    const templates = all.map(mapTemplateForCatalog);

    return res.render('templates', {
      title: 'Templates',
      activePage: 'templates',
      templates,
      pageCss: '/css/templates.catalog.css',
    });
  } catch (e) {
    return next(e);
  }
});

app.get('/templates/:slug', async (req, res, next) => {
  try {
    const slug = toStr(req.params.slug).trim();
    const tpl = await getTemplateBySlug(slug);

    if (!tpl) {
      return res.status(404).render('template-not-found', {
        title: 'Template not found',
        activePage: 'templates',
        slug,
      });
    }

    const template = mapTemplateForCatalog(tpl);

    return res.render('template-details', {
      title: template.title || 'Template',
      activePage: 'templates',
      template,
    });
  } catch (e) {
    return next(e);
  }
});

app.get('/:slug', async (req, res, next) => {
  try {
    const slug = toStr(req.params.slug).trim();

    const reserved = new Set([
      '__debug',
      '__whoami',
      'templates',
      'preview',
      'profile',
      'contact',
      'checkout',
      'success',
      'download',
      'api',
      'icons',
      'css',
      'seeds',
      't',
    ]);
    if (reserved.has(slug)) return next();

    const tpl = await getTemplateBySlug(slug);
    if (!tpl) return res.status(404).render('errors/404', { title: 'Page not found' });

    const template = mapTemplateForCatalog(tpl);
    return res.render('template-details', {
      title: template.title || 'Template',
      activePage: 'templates',
      template,
    });
  } catch (e) {
    return next(e);
  }
});

app.get('/preview/:slug', (req, res) => {
  const slug = toStr(req.params.slug).trim();
  if (!slug) return res.status(404).end();
  return res.redirect(`/seeds/${encodeURIComponent(slug)}/preview/preview.png`);
});

app.get('/checkout/success', (req, res) => {
  res.render('billing', { title: 'Checkout success' });
});

app.get('/success', (req, res) => {
  res.render('billing', { title: 'Success' });
});

app.get('/contact', (req, res) => {
  res.render('static/contact', { title: 'Contact', activePage: 'contact' });
});

app.get('/profile', (req, res) => {
  res.render('profile', { title: 'Profile', activePage: 'profile' });
});

// =========================
// Errors
// =========================
app.use((req, res) => {
  // 404
  if (req.accepts('json')) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  }
  if (req.accepts('text')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  return res.status(404).render('errors/404', { title: 'Page not found' });
});

 
app.use((err, req, res, next) => {
   
  console.error('[server] error:', err);

  const devText = isDev() ? String(err?.stack || err) : 'Server error';

  if (req.accepts('json')) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: isDev() ? String(err?.message || err) : 'Server error',
      },
    });
  }

  if (req.accepts('text')) {
    return res
      .status(500)
      .type('text/plain')
      .send(`[DEV] ${req.method} ${req.originalUrl} failed\n\n${devText}`);
  }

  return res.status(500).render('errors/500', {
    title: 'Server error',
    devError: isDev() ? devText : null,
  });
});

export default app;
