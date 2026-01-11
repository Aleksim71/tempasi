// src/app.js
// ESM. src/server.js делает: `import app from './app.js'`

import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';

import { engine } from 'express-handlebars';

import { getAllTemplates, getTemplateBySlug } from './db/templatesRepo.js';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------- helpers (HBS) -----------------
function normalizeDealFromType(type) {
  const v = String(type || '').toLowerCase();
  if (v === 'rent') return 'RENT';
  if (v === 'free') return 'FREE';
  return 'BUY';
}

const hbsHelpers = {
  eq: (a, b) => a === b,

  isFree: (price) => Number(price || 0) <= 0,

  formatPrice: (price) => {
    const p = Number(price || 0);
    if (!Number.isFinite(p)) return '—';
    if (p <= 0) return 'Free';
    return `${p.toFixed(0)} €`;
  },

  licenseLabel: (license) => {
    const v = String(license || '').toUpperCase();
    if (v === 'FREE') return 'Free';
    if (v === 'PU') return 'Personal';
    if (v === 'CU') return 'Commercial';
    if (v === 'EL') return 'Extended';
    return v || 'PU';
  },

  typeLabel: (type) => {
    const v = String(type || '').toLowerCase();
    if (v === 'buy') return 'Buy';
    if (v === 'rent') return 'Rent';
    if (v === 'free') return 'Free';
    return v || 'buy';
  },
};

// ----------------- route loader (CJS) -----------------
function pickRouter(mod, preferredKeys = []) {
  if (typeof mod === 'function') return mod;

  if (mod && typeof mod === 'object') {
    for (const k of preferredKeys) {
      if (typeof mod[k] === 'function') return mod[k];
    }
    if (typeof mod.router === 'function') return mod.router;
    if (mod.default && typeof mod.default === 'function') return mod.default;
  }

  const keys = mod && typeof mod === 'object' ? Object.keys(mod) : [];
  throw new Error(`[app.js] Cannot resolve router from CJS module. keys=${JSON.stringify(keys)}`);
}

// CJS routers
const authMod = require('./modules/auth/auth.routes.cjs');
const ordersMod = require('./modules/orders/orders.routes.cjs');
const downloadsMod = require('./modules/downloads/downloads.routes.cjs');

const profileMod = require('./modules/profile/profile.routes.cjs');
const profileApiMod = require('./modules/profile/profile.api.routes.cjs');

const authRouter = pickRouter(authMod, ['authRouter', 'authRoutes']);
const ordersRouter = pickRouter(ordersMod, ['ordersRouter', 'ordersRoutes']);
const downloadsRouter = pickRouter(downloadsMod, ['downloadsRouter', 'downloadsRoutes']);

const profileRouterFactory = pickRouter(profileMod, ['profileRoutes', 'profileRouter']);
const profileApiRouterFactory = pickRouter(profileApiMod, ['profileApiRoutes', 'profileApiRouter']);

const profileRouter = profileRouterFactory();
const profileApiRouter = profileApiRouterFactory();

// ----------------- app -----------------
const app = express();

// view engine (express-handlebars)
app.engine(
  'hbs',
  engine({
    extname: '.hbs',
    layoutsDir: path.join(__dirname, 'web', 'views', 'layouts'),
    partialsDir: path.join(__dirname, 'web', 'views', 'partials'),
    defaultLayout: 'main',
    helpers: hbsHelpers,
  }),
);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'web', 'views'));

// middleware
app.use(express.urlencoded({ extended: false })); // HTML forms
app.use(express.json({ limit: '1mb' })); // API

// static
app.use(express.static(path.join(__dirname, '..', 'public')));

// serve template previews/assets from storage/templates
app.use('/t', express.static(path.resolve(process.cwd(), 'storage', 'templates')));
app.use('/seeds', express.static(path.resolve(process.cwd(), 'storage', 'templates')));

// ---------- API ----------
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/profile', profileApiRouter);

// ---------- Downloads ----------
app.use('/download', downloadsRouter);

// ---------- SSR: Profile ----------
app.use('/profile', profileRouter);

// ---------- SSR: Catalog ----------
app.get('/', (_req, res) => res.redirect('/templates'));

app.get('/templates', async (req, res, next) => {
  try {
    const all = await getAllTemplates();

    const templates = all.map((t) => ({
      slug: t.slug,
      title: t.title,
      license: t.license,
      deal: normalizeDealFromType(t.type),
      zipReady: Boolean(t.hasZip),
      previewUrl: t.preview || null,
    }));

    return res.status(200).render('pages/templates/index', {
      title: 'Templates',
      activePage: 'templates',
      pageCss: '/css/templates.catalog.css', // ✅ ВОТ ОНО
      templates,
    });
  } catch (e) {
    return next(e);
  }
});

app.get('/templates/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const template = await getTemplateBySlug(slug);

    if (!template) {
      return res.status(404).render('pages/template-not-found', {
        title: 'Template not found',
        slug,
      });
    }

    return res.status(200).render('pages/template-details', {
      title: template.title || slug,
      template,
      activePage: 'templates',
    });
  } catch (e) {
    return next(e);
  }
});

// Preview route (B11 used /preview/:slug). MVP: просто показываем details.
app.get('/preview/:slug', (req, res) => {
  const slug = String(req.params.slug || '').trim();
  return res.redirect(`/templates/${encodeURIComponent(slug)}`);
});

// ---------- 404 ----------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not Found' } });
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
 

export default app;
