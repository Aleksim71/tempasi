// src/app.js
import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import exphbs from 'express-handlebars';

import { getAllTemplates, getTemplateBySlug } from './db/templatesRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// Handlebars
// =========================
const hbs = exphbs.create({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    eq(a, b) {
      return a === b;
    },
    formatPrice(cents) {
      if (cents == null) return '0 €';
      const euros = cents / 100;
      return `${euros.toLocaleString('de-DE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })} €`;
    },
  },
});

app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, 'views'));

// =========================
// Мидлвары
// =========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// статика из src/css, src/icons (мы монтируем их как /css и /icons)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/icons', express.static(path.join(__dirname, 'icons')));

// Текущий путь для подсветки активного пункта меню (если пригодится)
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// =========================
/* Роуты */
// =========================

// Главная = список шаблонов (как /templates)
app.get('/', async (req, res, next) => {
  try {
    const templates = await getAllTemplates();

    res.render('templates/index', {
      title: 'Tempasi — шаблоны',
      pageTitle: 'Шаблоны',
      pageSubtitle:
        'Готовые лендинги и сайты. Нажмите «Подробнее», чтобы открыть страницу шаблона.',
      templates,
      activePage: 'templates',
    });
  } catch (err) {
    next(err);
  }
});

// Список шаблонов
app.get('/templates', async (req, res, next) => {
  try {
    const templates = await getAllTemplates();

    res.render('templates/index', {
      title: 'Tempasi — шаблоны',
      pageTitle: 'Шаблоны',
      pageSubtitle:
        'Готовые лендинги и сайты. Нажмите «Подробнее», чтобы открыть страницу шаблона.',
      templates,
      activePage: 'templates',
    });
  } catch (err) {
    next(err);
  }
});

// Карточка отдельного шаблона
app.get('/templates/:slug', async (req, res, next) => {
  try {
    const tmpl = await getTemplateBySlug(req.params.slug);

    if (!tmpl) {
      return res.status(404).render('errors/404', {
        title: 'Шаблон не найден',
        activePage: 'templates',
      });
    }

    res.render('templates/show', {
      title: tmpl.title,
      template: tmpl,
      activePage: 'templates',
    });
  } catch (err) {
    next(err);
  }
});

// Профиль
app.get('/profile', (req, res) => {
  res.render('profile/index', {
    title: 'Профиль',
    activePage: 'profile',
  });
});

// ---------- Статические страницы ----------
app.get('/about', (req, res) => {
  res.render('static/about', {
    title: 'About',
    activePage: 'about',
  });
});

app.get('/contact', (req, res) => {
  res.render('static/contact', {
    title: 'Contact',
    activePage: 'contact',
  });
});

app.get('/community', (req, res) => {
  res.render('static/community', {
    title: 'Community',
    activePage: 'community',
  });
});

app.get('/deals', (req, res) => {
  res.render('static/deals', {
    title: 'Скидки',
    activePage: 'deals',
  });
});

// =========================
// 404 и 500
// =========================

// 404
app.use((req, res) => {
  res.status(404).render('errors/404', {
    title: 'Страница не найдена',
  });
});

// 500
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('errors/500', {
    title: 'Ошибка сервера',
    error: process.env.NODE_ENV === 'development' ? err : null,
  });
});

// =========================
// Старт сервера
// =========================
app.listen(PORT, () => {
  console.log(`Tempasi running at http://localhost:${PORT}`);
});
