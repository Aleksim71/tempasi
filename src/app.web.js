// src/app.web.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import express from 'express';
import hbs from 'hbs';

import { createWebRouter } from './web/routes/web.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/web
const WEB_DIR = path.join(__dirname, 'web');

// src/web/views
const VIEWS_DIR = path.join(WEB_DIR, 'views');

// src/web/views/partials
const PARTIALS_DIR = path.join(VIEWS_DIR, 'partials');

// public
const PUBLIC_DIR = path.join(process.cwd(), 'public');

function licenseLabel(v) {
  return String(v || '').toUpperCase();
}
function typeLabel(v) {
  return String(v || '').toUpperCase();
}
function formatPriceEUR(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}
function isFreePrice(v) {
  const n = Number(v);
  return Number.isFinite(n) && n <= 0;
}

let _initialized = false;

function safeReadPartial(filename) {
  const p = path.join(PARTIALS_DIR, filename);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function initHbsOnce(app) {
  if (_initialized) return;
  _initialized = true;

  app.set('views', VIEWS_DIR);
  app.set('view engine', 'hbs');

  // Register all partials from folder
  hbs.registerPartials(PARTIALS_DIR);

  // 🔒 Hard-register critical partials by name (prevents "could not be found")
  const siteHeader = safeReadPartial('site-header.hbs');
  if (siteHeader) hbs.registerPartial('site-header', siteHeader);

  const siteFooter = safeReadPartial('site-footer.hbs');
  if (siteFooter) hbs.registerPartial('site-footer', siteFooter);

  // ✅ Hard-register icons sprite (required for inline <use href="#...">)
  const iconsSprite = safeReadPartial('icons-sprite.hbs');
  if (iconsSprite) hbs.registerPartial('icons-sprite', iconsSprite);

  // helpers
  hbs.registerHelper('eq', (a, b) => String(a) === String(b));
  hbs.registerHelper('licenseLabel', (v) => licenseLabel(v));
  hbs.registerHelper('typeLabel', (v) => typeLabel(v));
  hbs.registerHelper('formatPrice', (v) => formatPriceEUR(v));
  hbs.registerHelper('isFree', (v) => isFreePrice(v));
}

export function createWebApp(app) {
  initHbsOnce(app);

  // static (css/js/img)
  app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: '1h' }));

  // mount web routes
  app.use(createWebRouter());

  return app;
}
