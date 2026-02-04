// src/app.web.js
import express from 'express';
import path from 'node:path';
import hbs from 'hbs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWebRouter } from './web/routes/web.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function registerPartialSafe(name, content) {
  if (!content) {
    console.warn('[web] partial missing:', name);
    return;
  }
  hbs.registerPartial(name, content);
}

export function createWebApp({ db }) {
  const app = express();

  // Expose db to routes
  app.locals.db = db;

  const viewsRoot = path.join(__dirname, 'web', 'views');
  const partialsRoot = path.join(viewsRoot, 'partials');

  // Views
  app.set('view engine', 'hbs');
  app.set('views', viewsRoot);
  app.set('view options', { layout: 'main' });

  console.log('[web] createWebApp() boot', { views: viewsRoot, partials: partialsRoot });

  // Partials (register directory; we'll also explicitly register critical ones)
  hbs.registerPartials(partialsRoot);

  // Explicit partial registration (bulletproof for the critical ones)
  const pIconsDash = path.join(partialsRoot, 'icons-sprite.hbs');
  const pIconsUnd = path.join(partialsRoot, 'icons_sprite.hbs');
  const pHeader = path.join(partialsRoot, 'site-header.hbs');

  // IMPORTANT: layout uses {{> footer}} and our file is partials/footer.hbs
  const pFooter = path.join(partialsRoot, 'footer.hbs');

  // Icons used by header (avoid "partial could not be found")
  const pIconSearch = path.join(partialsRoot, 'icon-search.hbs');
  const pIconCart = path.join(partialsRoot, 'icon-cart.hbs');
  const pIconLogin = path.join(partialsRoot, 'icon-login.hbs');
  const pIconLogout = path.join(partialsRoot, 'icon-logout.hbs');

  const iconsDash = safeRead(pIconsDash);
  const iconsUnd = safeRead(pIconsUnd);
  const header = safeRead(pHeader);
  const footer = safeRead(pFooter);

  const iconSearch = safeRead(pIconSearch);
  const iconCart = safeRead(pIconCart);
  const iconLogin = safeRead(pIconLogin);
  const iconLogout = safeRead(pIconLogout);

  // sprite (both names supported)
  if (iconsDash) registerPartialSafe('icons-sprite', iconsDash);
  if (iconsUnd) registerPartialSafe('icons_sprite', iconsUnd);
  if (!iconsDash && iconsUnd) registerPartialSafe('icons-sprite', iconsUnd);

  // critical layout partials
  registerPartialSafe('site-header', header);
  registerPartialSafe('footer', footer);

  // icon partials (support both dash + underscore names, just in case)
  registerPartialSafe('icon-search', iconSearch);
  registerPartialSafe('icon-cart', iconCart);
  registerPartialSafe('icon-login', iconLogin);
  registerPartialSafe('icon-logout', iconLogout);

  registerPartialSafe('icon_search', iconSearch);
  registerPartialSafe('icon_cart', iconCart);
  registerPartialSafe('icon_login', iconLogin);
  registerPartialSafe('icon_logout', iconLogout);

  // Helpers
  hbs.registerHelper('eq', (a, b) => a === b);

  // Header state middleware (guest / authed)
  app.use((req, res, next) => {
    const user = req.user || (req.session && req.session.user) || null;
    res.locals.user = user;
    res.locals.isAuthed = Boolean(user);
    next();
  });

  // Static
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Health + root UX
  app.get('/__health', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.redirect(302, '/templates'));

  // Web routes
  app.use(createWebRouter());

  return app;
}
