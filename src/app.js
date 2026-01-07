// src/app.js
import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import exphbs from 'express-handlebars';

import { getAllTemplates, getTemplateBySlug } from './db/templatesRepo.js';
import { findZipForSlug } from './server/downloads/findZipForSlug.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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

// IMPORTANT (B5/B6/B7): preview images live in storage/templates/**/preview/preview.png
// We serve them under /seeds/seed-xxx/...
const STORAGE_TEMPLATES_DIR = path.resolve(process.cwd(), 'storage', 'templates');
app.use('/seeds', express.static(STORAGE_TEMPLATES_DIR));

// B9/B10: Live preview assets of template itself
// /t/seed-001/src/index.html (and relative ../assets)
app.use('/t', express.static(STORAGE_TEMPLATES_DIR));

// =========================
// Helpers
// =========================
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// =========================
// Routes
// =========================
async function renderCatalog(req, res, next) {
  try {
    const all = await getAllTemplates();

    const categories = uniqSorted(all.map((t) => t.category));
    const licenses = uniqSorted(all.map((t) => normalizeLicense(t.license)));
    const types = uniqSorted(all.map((t) => normalizeType(t.type)));

    const { items, filters } = applyFilters(all, req.query);

    res.render('templates/index', {
      title: 'Tempasi — Templates',
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

app.get('/', renderCatalog);
app.get('/templates', renderCatalog);

// Template details
app.get('/templates/:slug', async (req, res, next) => {
  try {
    const tmpl = await getTemplateBySlug(req.params.slug);

    if (!tmpl) {
      return res.status(404).render('errors/404', {
        title: 'Template not found',
        activeNav: 'templates',
      });
    }

    res.render('template-details', {
      title: tmpl.title,
      template: tmpl,
      activeNav: 'templates',
    });
  } catch (err) {
    next(err);
  }
});

// B10/B10.2: Live preview page with sticky CTA
app.get('/preview/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const tmpl = await getTemplateBySlug(slug);

    if (!tmpl) {
      return res.status(404).render('errors/404', {
        title: 'Template not found',
        activeNav: 'templates',
      });
    }

    const iframeSrc = `/t/${encodeURIComponent(slug)}/src/index.html`;

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
  <span style="opacity:.7">• ${escapeHtml(slug)}</span>
  <a href="/templates/${encodeURIComponent(slug)}">Back</a>
  <a class="cta" href="/download/${encodeURIComponent(slug)}">Download ZIP</a>
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

// Download zip
app.get('/download/:slug', (req, res) => {
  const hit = findZipForSlug(req.params.slug);
  if (!hit) {
    return res.status(404).render('errors/404', {
      title: 'Archive not found',
      activeNav: 'templates',
    });
  }
  res.download(hit.absPath, hit.fileName);
});

// Profile
app.get('/profile', (req, res) => {
  res.render('profile/index', {
    title: 'Profile',
    activeNav: 'profile',
  });
});

// Contact
app.get('/contact', (req, res) => {
  res.render('static/contact', {
    title: 'Contact',
    activeNav: 'contact',
  });
});

// Errors
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page not found' });
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('errors/500', {
    title: 'Server error',
    error: process.env.NODE_ENV === 'development' ? err : null,
  });
});

export default app;

// =========================
// Utils
// =========================
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
