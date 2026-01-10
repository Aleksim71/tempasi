// src/app.js
import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import exphbs from 'express-handlebars';
import { createRequire } from 'node:module';

import { getAllTemplates, getTemplateBySlug } from './db/templatesRepo.js';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.get('/__whoami', (_req, res) => {
  res.json({ ok: true, file: 'src/app.js', ts: new Date().toISOString() });
});

// DEBUG: log every request (temporary)
app.use((req, _res, next) => {
  console.log('[REQ]', req.method, req.url);
  next();
});

// =========================
// Handlebars (SSR)
// =========================
const VIEWS_ROOT = path.join(__dirname, 'web', 'views');

function normalizeLicense(raw) {
  if (!raw) return 'PU';
  const v = String(raw).trim().toUpperCase();
  if (v === 'FREE') return 'FREE';
  if (v === 'PERSONAL' || v === 'PU') return 'PU';
  if (v === 'COMMERCIAL' || v === 'CU') return 'CU';
  if (v === 'EXTENDED' || v === 'EL') return 'EL';
  return v;
}

function licenseLabel(raw) {
  const v = normalizeLicense(raw);
  if (v === 'FREE') return 'Free';
  if (v === 'PU') return 'PU (Personal)';
  if (v === 'CU') return 'CU (Commercial)';
  if (v === 'EL') return 'EL (Extended)';
  return v;
}

function normalizeType(raw) {
  if (!raw) return 'buy';
  const v = String(raw).trim().toLowerCase();
  if (['buy', 'rent', 'free'].includes(v)) return v;
  return 'buy';
}

function typeLabel(raw) {
  const v = normalizeType(raw);
  if (v === 'rent') return 'Rent';
  if (v === 'free') return 'Free';
  return 'Buy';
}

function toStr(v) {
  return v == null ? '' : String(v);
}

function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en'));
}

function applyFilters(all, q) {
  const query = toStr(q.q).trim().toLowerCase();
  const category = toStr(q.category).trim();
  const license = normalizeLicense(toStr(q.license).trim() || '');
  const type = normalizeType(toStr(q.type).trim() || '');
  const onlyReady = toStr(q.ready).trim() === '1';
  const sort = toStr(q.sort).trim() || 'name_asc';

  let items = all.slice();

  if (query) {
    items = items.filter((t) => {
      const hay = `${t.title ?? ''} ${t.description ?? ''}`.toLowerCase();
      return hay.includes(query);
    });
  }

  if (category) {
    items = items.filter((t) => (t.category ?? '') === category);
  }

  if (toStr(q.license).trim()) {
    items = items.filter((t) => normalizeLicense(t.license) === license);
  }

  if (toStr(q.type).trim()) {
    items = items.filter((t) => normalizeType(t.type) === type);
  }

  if (onlyReady) {
    items = items.filter((t) => Boolean(t.hasZip));
  }

  if (sort === 'price_asc') {
    items.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  } else if (sort === 'price_desc') {
    items.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  } else {
    items.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'en'));
  }

  return {
    items,
    filters: {
      q: query ? toStr(q.q).trim() : '',
      category,
      license: toStr(q.license).trim(),
      type: toStr(q.type).trim(),
      ready: onlyReady ? '1' : '',
      sort,
    },
  };
}

const hbs = exphbs.create({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(VIEWS_ROOT, 'layouts'),
  partialsDir: path.join(VIEWS_ROOT, 'partials'),
  helpers: {
    eq(a, b) {
      return a === b;
    },
    formatPrice(cents) {
      if (!cents) return 'Free';
      const euros = cents / 100;
      return `${euros.toLocaleString('de-DE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })} €`;
    },
    licenseLabel,
    typeLabel,
    isFree(price) {
      return !price || Number(price) <= 0;
    },
  },
});

app.engine('.hbs', hbs.engine);
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
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

const STORAGE_TEMPLATES_DIR = path.resolve(process.cwd(), 'storage', 'templates');
app.use('/seeds', express.static(STORAGE_TEMPLATES_DIR));
app.use('/t', express.static(STORAGE_TEMPLATES_DIR));

// =========================
// Helpers
// =========================
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// =========================
// B12 API + Downloads (CJS routers mounted from ESM via createRequire)
// =========================
try {
  const orders = require('./modules/orders/orders.routes.cjs');
  const payments = require('./modules/payments/payments.routes.cjs');
  const downloads = require('./modules/downloads/downloads.routes.cjs');

  app.use('/api/orders', orders);
  app.use('/api/payments', payments);
  app.use('/download', downloads);

  console.log('[B12] routes mounted: /api/orders, /api/payments, /download');
} catch (e) {
  console.error('[B12] mount failed:', e?.message || e);
}

// =========================
// Routes (SSR)
// =========================
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
    title: t.title ?? slug,
    license,
    deal,
    zipReady: hasZip,
    previewUrl,
  };
}

async function renderCatalog(req, res, next) {
  try {
    const allRaw = await getAllTemplates();
    const all = allRaw.map(mapTemplateForCatalog);

    const categories = uniqSorted(all.map((t) => t.category));
    const licenses = uniqSorted(all.map((t) => normalizeLicense(t.license)));
    const types = uniqSorted(all.map((t) => normalizeType(t.type)));

    const { items, filters } = applyFilters(all, req.query);

    res.render('templates/index', {
      title: 'Tempasi — Templates',
      pageCss: '/css/templates.catalog.css',
      pageJs: '/js/templates.filters.js',
      pageTitle: 'Templates',
      pageSubtitle: 'Filter by category / license / type and download ready ZIPs.',
      templates: items,
      activeNav: 'templates',
      options: {
        categories,
        licenses,
        types,
        sorts: [
          { value: 'name_asc', label: 'Name (A→Z)' },
          { value: 'price_asc', label: 'Price (low→high)' },
          { value: 'price_desc', label: 'Price (high→low)' },
        ],
      },
      filters,
    });
  } catch (err) {
    next(err);
  }
}

// DEBUG: show routes with mount prefixes (temporary)
app.get('/__debug/routes2', (_req, res) => {
  const stack =
    (app && app._router && app._router.stack) || (app && app.router && app.router.stack) || [];

  function methods(route) {
    return Object.keys(route.methods || {})
      .filter((k) => route.methods[k])
      .map((k) => k.toUpperCase());
  }

  function prefixFromLayer(layer) {
    // layer.regexp обычно выглядит так: /^\/api\/orders\/?(?=\/|$)/i
    const re = String(layer.regexp || '');
    const anchor = '^\\/';
    const i = re.indexOf(anchor);
    if (i === -1) return '';

    let rest = re.slice(i + anchor.length);

    // отрежем всё после \ /? или (?=
    const cut1 = rest.indexOf('\\/?');
    const cut2 = rest.indexOf('(?=');
    let cut = -1;
    if (cut1 !== -1 && cut2 !== -1) cut = Math.min(cut1, cut2);
    else cut = cut1 !== -1 ? cut1 : cut2;

    if (cut !== -1) rest = rest.slice(0, cut);

    // rest сейчас типа: api\/orders
    const p = '/' + rest.replaceAll('\\/', '/');
    return p === '/' ? '' : p;
  }

  const routes = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const m of methods(layer.route)) routes.push({ method: m, path: layer.route.path });
      continue;
    }
    if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
      const pfx = prefixFromLayer(layer);
      for (const l of layer.handle.stack) {
        if (!l.route) continue;
        for (const m of methods(l.route)) routes.push({ method: m, path: pfx + l.route.path });
      }
    }
  }

  routes.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
  res.json({ count: routes.length, routes });
});

app.get('/', renderCatalog);
app.get('/templates', renderCatalog);

app.get('/templates/:slug', async (req, res, next) => {
  try {
    const tmplRaw = await getTemplateBySlug(req.params.slug);
    if (!tmplRaw) {
      return res.status(404).render('errors/404', {
        title: 'Template not found',
        activeNav: 'templates',
      });
    }

    const tmpl = mapTemplateForCatalog(tmplRaw);

    res.render('template-details', {
      title: tmpl.title,
      template: tmpl,
      activeNav: 'templates',
    });
  } catch (err) {
    next(err);
  }
});

app.get('/preview/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const tmplRaw = await getTemplateBySlug(slug);

    if (!tmplRaw) {
      return res.status(404).render('errors/404', {
        title: 'Template not found',
        activeNav: 'templates',
      });
    }

    const tmpl = mapTemplateForCatalog(tmplRaw);
    const iframeSrc = `/t/${encodeURIComponent(tmpl.slug)}/src/index.html`;

    const ctaHtml = tmpl.zipReady
      ? `<a class="cta" href="/download/${encodeURIComponent(tmpl.slug)}">Download ZIP</a>`
      : `<span class="cta cta--disabled" aria-disabled="true">ZIP soon</span>`;

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Preview — ${escapeHtml(tmpl.title)}</title>
<style>
html,body{height:100%;margin:0}
body{background:#0b1020;font-family:system-ui,-apple-system,Segoe UI,Roboto}
header{
  position:sticky;top:0;z-index:20;
  display:flex;align-items:center;gap:12px;
  padding:12px 16px;
  background:rgba(10,16,32,.85);
  backdrop-filter:blur(10px);
  color:#fff
}
header a{color:#9fb3ff;text-decoration:none}
header a:hover{text-decoration:underline}
.cta{
  margin-left:auto;
  padding:10px 16px;
  border-radius:999px;
  background:#7a66ff;
  color:#fff;
  font-weight:600;
  text-decoration:none
}
.cta--disabled{
  background:rgba(255,255,255,.14);
  color:rgba(255,255,255,.75);
  cursor:not-allowed
}
.wrap{height:calc(100% - 56px);padding:16px}
iframe{
  width:100%;height:100%;
  border:0;border-radius:16px;
  background:#fff;
  box-shadow:0 18px 40px rgba(0,0,0,.35)
}
</style>
</head>
<body>
<header>
  <strong>${escapeHtml(tmpl.title)}</strong>
  <span style="opacity:.7">• ${escapeHtml(tmpl.slug)}</span>
  <a href="/templates/${encodeURIComponent(tmpl.slug)}">Back</a>
  ${ctaHtml}
</header>
<div class="wrap">
  <iframe src="${iframeSrc}"></iframe>
</div>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

// =========================
// Checkout success (DEV) — thin route only
// =========================
// Логика вынесена в CJS контроллер: src/modules/payments/checkoutSuccessDev.controller.cjs
app.get('/checkout/success', async (req, res, next) => {
  try {
    const mod = require('./modules/payments/checkoutSuccessDev.controller.cjs');
    const fn = mod?.handleCheckoutSuccessDev;
    if (typeof fn !== 'function') {
      const err = new Error('CHECKOUT_SUCCESS_HANDLER_MISSING');
      err.status = 500;
      throw err;
    }
    await fn(req, res);
  } catch (err) {
    next(err);
  }
});

app.get('/profile', (req, res) => {
  res.render('profile/index', { title: 'Profile', activeNav: 'profile' });
});

app.get('/contact', (req, res) => {
  res.render('static/contact', { title: 'Contact', activeNav: 'contact' });
});

// =========================
// DEBUG: dump routes
// =========================
app.get('/__debug/routes', (req, res) => {
  function getStack(app) {
    return (
      (app && app._router && app._router.stack) || (app && app.router && app.router.stack) || []
    );
  }

  function methods(route) {
    return Object.keys(route.methods || {})
      .filter((k) => route.methods[k])
      .map((k) => k.toUpperCase())
      .sort()
      .join(',');
  }

  function dump(layer, prefix = '') {
    const out = [];

    if (layer?.route) {
      out.push({ method: methods(layer.route), path: prefix + layer.route.path });
      return out;
    }

    // nested router
    const stack = layer?.handle?.stack || layer?.handle?._router?.stack;
    if (!stack) return out;

    // try to extract readable prefix from regexp
    const re = String(layer.regexp || '');
    let p = '';
    const m = re.match(/\\\/([A-Za-z0-9_\\\/\-]+)\\\/\?\(\?=\\\/\|\$\)/);
    if (m) p = '/' + m[1].replaceAll('\\/', '/');

    for (const l of stack) out.push(...dump(l, prefix + p));
    return out;
  }

  const stack = getStack(req.app);
  let routes = [];
  for (const layer of stack) routes.push(...dump(layer, ''));

  routes = routes
    .filter((r) => r.method && r.path)
    .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));

  res.json({ count: routes.length, routes });
});

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page not found' });
});

// ✅ FIX: respect err.status (401/403/400 must not become 500)
app.use((err, req, res, _next) => {
  const status = Number.isFinite(err?.status) ? err.status : 500;

  console.error('[ERR]', status, err && (err.stack || err));
  console.error(err);

  if (status === 404) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  return res.status(status).render('errors/500', {
    title: status === 500 ? 'Server error' : 'Request error',
    error: process.env.NODE_ENV === 'development' ? err : null,
  });
});

export default app;

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
