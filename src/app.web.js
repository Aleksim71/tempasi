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

  // Partials (only true partials; pages are rendered via res.render(view))
  hbs.registerPartials(partialsRoot);

  // Explicit partial registration (bulletproof for the critical ones)
  const pIconsDash = path.join(partialsRoot, 'icons-sprite.hbs');
  const pIconsUnd = path.join(partialsRoot, 'icons_sprite.hbs');
  const pHeader = path.join(partialsRoot, 'site-header.hbs');
  const pFooter = path.join(partialsRoot, 'site-footer.hbs');

  const iconsDash = safeRead(pIconsDash);
  const iconsUnd = safeRead(pIconsUnd);
  const header = safeRead(pHeader);
  const footer = safeRead(pFooter);

  if (iconsDash) hbs.registerPartial('icons-sprite', iconsDash);
  if (iconsUnd) hbs.registerPartial('icons_sprite', iconsUnd);
  if (!iconsDash && iconsUnd) hbs.registerPartial('icons-sprite', iconsUnd);

  if (header) hbs.registerPartial('site-header', header);
  if (footer) hbs.registerPartial('site-footer', footer);

  // Helpers
  hbs.registerHelper('eq', (a, b) => a === b);

  // Static
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Health + root UX
  app.get('/__health', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.redirect(302, '/templates'));

  // Web routes
  app.use(createWebRouter());

  return app;
}
