// src/app.js
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { engine } from 'express-handlebars';

// Загружаем .env
dotenv.config();

const app = express();

// === Пути ======================================================
const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Папка с HTML/CSS/icons (статические файлы)
const publicDir = path.join(__dirname, '..', 'mvp-tempasi');

// === Настройка Handlebars ======================================
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

// === Раздача статики ===========================================
app.use(express.static(publicDir));

// === Маршруты Handlebars =======================================

// Главная страница → templates.hbs
app.get('/', (req, res) => {
  res.render('templates');
});

// /index.html также обрабатываем корректно
app.get('/index.html', (req, res) => {
  res.render('templates');
});

// Страницы, которые пока не переведены в HBS — можно временно отдавать напрямую
const staticPages = [
  'about.html',
  'billing.html',
  'community.html',
  'contact.html',
  'deals.html',
  'favorites.html',
  'login.html',
  'profile.html',
  'register.html',
  'rentals.html',
];

// Временно отдаём старые HTML файлы
staticPages.forEach((file) => {
  const route = '/' + file.replace('.html', '');
  app.get(route, (req, res) => {
    res.sendFile(path.join(publicDir, file));
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
