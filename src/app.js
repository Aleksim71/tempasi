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
  // поддержим несколько вариантов написания
  if (v === 'FREE') return 'FREE';
  if (v === 'PERSONAL' || v === 'PU') return 'PU';
  if (v === 'COMMERCIAL' || v === 'CU') return 'CU';
  if (v === 'EXTENDED' || v === 'EL') return 'EL';
  return v; // если потом добавишь свои коды
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
    licenseLabel(v) {
      return licenseLabel(v);
    },
    typeLabel(v) {
      return typeLabel(v);
    },
    isFree(price) {
      return !price || Number(price) <= 0;
    },
  },
});

app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');

// pages лежат в src/web/views/pages
app.set('views', path.join(VIEWS_ROOT, 'pages'));

// =========================
// Middleware
// =========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// =========================
// Static
// =========================

// public/*
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// seeds/*  → storage/templates/*
const SEEDS_DIR = path.resolve(process.cwd(), 'storage', 'templates');
app.use('/seeds', express.static(SEEDS_DIR));

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
app.get('/', async (req, res, next) => {
  try {
    const templates = await getAllTemplates();
    res.render('templates/index', {
      title: 'Tempasi — шаблоны',
      pageTitle: 'Шаблоны',
      pageSubtitle:
        'Готовые лендинги и сайты. Нажмите «Подробнее», чтобы открыть страницу шаблона.',
      templates,
      activeNav: 'templates',
    });
  } catch (err) {
    next(err);
  }
});

app.get('/templates', async (req, res, next) => {
  try {
    const templates = await getAllTemplates();
    res.render('templates/index', {
      title: 'Tempasi — шаблоны',
      pageTitle: 'Шаблоны',
      pageSubtitle:
        'Готовые лендинги и сайты. Нажмите «Подробнее», чтобы открыть страницу шаблона.',
      templates,
      activeNav: 'templates',
    });
  } catch (err) {
    next(err);
  }
});

app.get('/templates/:slug', async (req, res, next) => {
  try {
    const tmpl = await getTemplateBySlug(req.params.slug);

    if (!tmpl) {
      return res.status(404).render('errors/404', {
        title: 'Шаблон не найден',
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

// =========================
// B6: Download zip
// =========================
app.get('/download/:slug', async (req, res) => {
  const { slug } = req.params;

  const hit = findZipForSlug(slug);

  if (!hit) {
    return res.status(404).render('errors/404', {
      title: 'Архив не найден',
      activeNav: 'templates',
    });
  }

  return res.download(hit.absPath, hit.fileName);
});

// Профиль
app.get('/profile', (req, res) => {
  res.render('profile/index', {
    title: 'Профиль',
    activeNav: 'profile',
  });
});

// Контакты
app.get('/contact', (req, res) => {
  res.render('static/contact', {
    title: 'Contact',
    activeNav: 'contact',
  });
});

// =========================
// 404 и 500
// =========================
app.use((req, res) => {
  res.status(404).render('errors/404', {
    title: 'Страница не найдена',
  });
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('errors/500', {
    title: 'Ошибка сервера',
    error: process.env.NODE_ENV === 'development' ? err : null,
  });
});

export default app;
