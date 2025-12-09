// src/app.js
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { engine } from 'express-handlebars';

import { getAllTemplates, getTemplateBySlug } from './db/templatesRepo.js';

dotenv.config();

const app = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Папки c CSS и иконками (Новая структура)
const cssDir = path.join(__dirname, 'css');
const iconsDir = path.join(__dirname, 'icons');

// СТАРАЯ статика (выносим в самый конец!)
const oldUiDir = path.join(__dirname, '..', 'mvp-tempasi');

// ====================== Handlebars ======================
app.engine(
  'hbs',
  engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views', 'layouts'),
    partialsDir: path.join(__dirname, 'views', 'partials'),
  }),
);

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// ====================== Маршруты (ВЫШЕ статики!) ======================

// Главная → каталог шаблонов
app.get('/', (req, res) => {
  res.redirect('/templates');
});

// /index.html → тоже каталог
app.get('/index.html', (req, res) => {
  res.redirect('/templates');
});

// ================== Каталог шаблонов ==================
app.get('/templates', async (req, res, next) => {
  try {
    const templates = await getAllTemplates();

    res.render('templates', {
      title: 'Templates — Tempasi',
      templates,
    });
  } catch (err) {
    next(err);
  }
});

// ================== Детализация шаблона ==================
app.get('/templates/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const tpl = await getTemplateBySlug(slug);

    if (!tpl) {
      return res.status(404).render('template-not-found', {
        title: 'Шаблон не найден — Tempasi',
        slug,
      });
    }

    res.render('template-details', {
      title: `${tpl.title} — Tempasi`,
      template: tpl,
    });
  } catch (err) {
    next(err);
  }
});

// ================== Профиль ==================
app.get('/profile', (req, res) => {
  res.render('profile', {
    title: 'Профиль — Tempasi',
  });
});

// ================== Billing ==================
app.get('/billing', (req, res) => {
  res.render('billing', {
    title: 'Billing — Tempasi',
    user: {
      username: 'Demo User',
      email: 'you@example.com',
      avatar: '/icons/user-avatar-demo.png',
    },
    billingItems: [
      { name: 'Nova SaaS — Landing', date: '2025-01-01', price: '€89', status: 'Оплачен' },
      { name: 'E-Com Pro', date: '2025-01-15', price: '€149', status: 'Оплачен' },
      { name: 'Portfolio Light', date: '2025-02-02', price: '€59', status: 'В обработке' },
    ],
  });
});

// ================== Login ==================
app.get('/login', (req, res) => {
  res.render('login', {
    layout: 'auth',
    title: 'Login — Tempasi',
  });
});

// ================== Register ==================
app.get('/register', (req, res) => {
  res.render('register', {
    layout: 'auth',
    title: 'Register — Tempasi',
  });
});

// ================== API ==================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'dev',
  });
});

// ====================== СТАТИКА (в самом конце!) ======================
// Теперь статика НЕ ломает маршруты
app.use('/css', express.static(cssDir));
app.use('/icons', express.static(iconsDir));

// Старый UI — только после всех маршрутов
app.use(express.static(oldUiDir));

// ====================== Запуск сервера ======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 Tempasi server running at http://localhost:${PORT}`);
  console.log(`📂 Serving old UI from: ${oldUiDir}`);
});
