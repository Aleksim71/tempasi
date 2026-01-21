// src/app.web.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handlebars from 'express-handlebars';

import { createWebRouter } from './web/routes/web.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// public/ рядом с src/
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// views лежат в src/web/views
const VIEWS_DIR = path.join(__dirname, 'web', 'views');

// Минимальный набор helpers для шаблонов
const hbsHelpers = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  not: (v) => !v,
  and: (...args) => args.slice(0, -1).every(Boolean), // последний аргумент — options
  or: (...args) => args.slice(0, -1).some(Boolean),
};

export function createWebApp(opts = {}) {
  const { services = {} } = opts;

  const app = express();

  // view engine (hbs)
  app.engine(
    'hbs',
    handlebars.engine({
      extname: '.hbs',
      layoutsDir: path.join(VIEWS_DIR, 'layouts'),
      partialsDir: path.join(VIEWS_DIR, 'partials'),
      defaultLayout: 'main',
      helpers: hbsHelpers,
    }),
  );
  app.set('view engine', 'hbs');
  app.set('views', VIEWS_DIR);

  // 1) SSR routes
  app.use(createWebRouter({ services }));

  // 2) /t (превью и ассеты шаблонов)
  app.use('/t', express.static(path.join(PUBLIC_DIR, 't'), { etag: true, maxAge: '1h' }));

  // 3) общая статика
  app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: '1h' }));

  return app;
}
