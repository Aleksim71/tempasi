// src/app.js
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { engine } from 'express-handlebars';
import { templates } from './data/templates.js';

dotenv.config();

const app = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Папка с HTML-страницами (старый UI)
const publicDir = path.join(__dirname, '..', 'mvp-tempasi');

// ===== Handlebars =====
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

// Статика: CSS и иконки из src/
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/icons', express.static(path.join(__dirname, 'icons')));

// Статика: старые HTML-страницы
app.use(express.static(publicDir));

// Главная страница → редирект на /templates
app.get('/', (req, res) => {
  res.redirect('/templates');
});

// /index.html тоже ведёт на /templates
app.get('/index.html', (req, res) => {
  res.redirect('/templates');
});

// Страница каталога шаблонов
app.get('/templates', (req, res) => {
  res.render('templates', {
    title: 'Tempasi Templates',
    templates,
  });
});

// Страница профиля (HBS)
app.get('/profile', (req, res) => {
  res.render('profile', {
    title: 'Профиль — Tempasi Templates',
  });
});

// Страница Billing (HBS)
app.get('/billing', (req, res) => {
  res.render('billing', {
    title: 'Billing — Tempasi',
    user: {
      username: 'Demo User',
      email: 'you@example.com',
      avatar: '/icons/user-avatar-demo.png',
    },
    billingItems: [
      {
        name: 'Nova SaaS — Landing',
        date: '2025-01-01',
        price: '€89',
        status: 'Оплачен',
      },
      {
        name: 'E‑Com Pro',
        date: '2025-01-15',
        price: '€149',
        status: 'Оплачен',
      },
      {
        name: 'Portfolio Light',
        date: '2025-02-02',
        price: '€59',
        status: 'В обработке',
      },
    ],
  });
});

// Страница логина (HBS)
app.get('/login', (req, res) => {
  res.render('login', {
    layout: 'auth',
    title: 'Login — Tempasi',
  });
});

// Страница регистрации (HBS)
app.get('/register', (req, res) => {
  res.render('register', {
    layout: 'auth',
    title: 'Register — Tempasi',
  });
});

// === API-заглушка ===============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'dev',
  });
});

// === Запуск сервера =============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 Tempasi server running at: http://localhost:${PORT}`);
  console.log(`📂 Serving static files from: ${publicDir}`);
});
