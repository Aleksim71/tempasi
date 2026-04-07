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

function readFirstExisting(paths) {
  for (const p of paths) {
    const c = safeRead(p);
    if (c) return c;
  }
  return null;
}

export function createWebApp({ db }) {
  const app = express();

  app.locals.db = db;

  const viewsRoot = path.join(__dirname, 'web', 'views');
  const partialsRoot = path.join(viewsRoot, 'partials');

  app.set('view engine', 'hbs');
  app.set('views', viewsRoot);

  // ✅ force correct layout file
  app.set('view options', { layout: 'layouts/main' });

  console.log('[web] createWebApp() boot', { views: viewsRoot, partials: partialsRoot });

  // Register partials dir (may NOT recurse into subfolders depending on hbs version)
  hbs.registerPartials(partialsRoot);

  // Critical partials
  const pIconsDash = path.join(partialsRoot, 'icons-sprite.hbs');
  const pIconsUnd = path.join(partialsRoot, 'icons_sprite.hbs');
  const pHeader = path.join(partialsRoot, 'site-header.hbs');
  const pFooter = path.join(partialsRoot, 'footer.hbs');

  // header icons
  const pIconSearch = path.join(partialsRoot, 'icon-search.hbs');
  const pIconCart = path.join(partialsRoot, 'icon-cart.hbs');
  const pIconLogin = path.join(partialsRoot, 'icon-login.hbs');
  const pIconLogout = path.join(partialsRoot, 'icon-logout.hbs');

  // Template card v2
  const pTemplateCardV2 = path.join(partialsRoot, 'template-card.v2.hbs');

  // --- Cabinet space partials (with fallback to old root-level files) ---
  // New preferred location:
  //   partials/cabinet/space-*.hbs
  // Old location you already have:
  //   partials/space-*.hbs
  const cabinetCases = readFirstExisting([
    path.join(partialsRoot, 'cabinet', 'space-cases.hbs'),
    path.join(partialsRoot, 'space-cases.hbs'),
  ]);

  const cabinetMyTemplates = readFirstExisting([
    path.join(partialsRoot, 'cabinet', 'space-my-templates.hbs'),
    path.join(partialsRoot, 'space-my-templates.hbs'),
  ]);

  const cabinetFinance = readFirstExisting([
    path.join(partialsRoot, 'cabinet', 'space-finance.hbs'),
    path.join(partialsRoot, 'space-finance.hbs'),
  ]);

  const cabinetProfileSecurity = readFirstExisting([
    path.join(partialsRoot, 'cabinet', 'space-profile-security.hbs'),
    // если у тебя пока нет отдельного файла — fallback не сработает, но мы хотя бы не сломаем cases/finance/etc.
    path.join(partialsRoot, 'space-profile-security.hbs'),
  ]);

  const cabinetSupport = readFirstExisting([
    path.join(partialsRoot, 'cabinet', 'space-support.hbs'),
    path.join(partialsRoot, 'space-support.hbs'),
  ]);

  const iconsDash = safeRead(pIconsDash);
  const iconsUnd = safeRead(pIconsUnd);
  const header = safeRead(pHeader);
  const footer = safeRead(pFooter);

  const iconSearch = safeRead(pIconSearch);
  const iconCart = safeRead(pIconCart);
  const iconLogin = safeRead(pIconLogin);
  const iconLogout = safeRead(pIconLogout);

  const templateCardV2 = safeRead(pTemplateCardV2);

  // sprite (both names supported)
  if (iconsDash) registerPartialSafe('icons-sprite', iconsDash);
  if (iconsUnd) registerPartialSafe('icons_sprite', iconsUnd);
  if (!iconsDash && iconsUnd) registerPartialSafe('icons-sprite', iconsUnd);

  // layout partials
  registerPartialSafe('site-header', header);
  registerPartialSafe('footer', footer);

  // icon partials (dash + underscore)
  registerPartialSafe('icon-search', iconSearch);
  registerPartialSafe('icon-cart', iconCart);
  registerPartialSafe('icon-login', iconLogin);
  registerPartialSafe('icon-logout', iconLogout);

  registerPartialSafe('icon_search', iconSearch);
  registerPartialSafe('icon_cart', iconCart);
  registerPartialSafe('icon_login', iconLogin);
  registerPartialSafe('icon_logout', iconLogout);

  // v2 partial name (with dot)
  registerPartialSafe('template-card.v2', templateCardV2);

  // ✅ Cabinet partial aliases (REGISTER BOTH styles)
  // cases
  registerPartialSafe('space-cases', cabinetCases);
  registerPartialSafe('cabinet-space-cases', cabinetCases);
  registerPartialSafe('cabinet/space-cases', cabinetCases);

  // my-templates
  registerPartialSafe('space-my-templates', cabinetMyTemplates);
  registerPartialSafe('cabinet-space-my-templates', cabinetMyTemplates);
  registerPartialSafe('cabinet/space-my-templates', cabinetMyTemplates);

  // finance
  registerPartialSafe('space-finance', cabinetFinance);
  registerPartialSafe('cabinet-space-finance', cabinetFinance);
  registerPartialSafe('cabinet/space-finance', cabinetFinance);

  // profile-security
  registerPartialSafe('space-profile-security', cabinetProfileSecurity);
  registerPartialSafe('cabinet-space-profile-security', cabinetProfileSecurity);
  registerPartialSafe('cabinet/space-profile-security', cabinetProfileSecurity);

  // support
  registerPartialSafe('space-support', cabinetSupport);
  registerPartialSafe('cabinet-space-support', cabinetSupport);
  registerPartialSafe('cabinet/space-support', cabinetSupport);

  // Helpers
  hbs.registerHelper('eq', (a, b) => a === b);
  hbs.registerHelper('and', (...args) => {
    const values = args.slice(0, -1);
    return values.every(Boolean);
  });
  hbs.registerHelper('or', (...args) => {
    const values = args.slice(0, -1);
    return values.some(Boolean);
  });
  hbs.registerHelper('not', (value) => !value);

  // Header state middleware + cart counter
  app.use((req, res, next) => {
    const user = req.user || (req.session && req.session.user) || null;
    res.locals.user = user;
    res.locals.isAuthed = Boolean(
      user ||
      req?.userId ||
      req?.session?.userId ||
      req?.session?.user_id ||
      req?.user?.id ||
      req?.user?.user_id ||
      req?.user?.userId,
    );
    res.locals.cartCount = 0;

    const rawUserId =
      req?.user?.id ??
      req?.user?.user_id ??
      req?.user?.userId ??
      req?.session?.userId ??
      req?.session?.user_id ??
      req?.userId ??
      null;

    const userId = Number(rawUserId);
    if (!Number.isFinite(userId) || userId <= 0) return next();

    const db = app.locals?.db;
    if (!db || typeof db.query !== 'function') return next();

    db.query(
      `
        SELECT COUNT(*)::int AS count
        FROM cart_items
        WHERE user_id = $1
      `,
      [userId],
    )
      .then(({ rows }) => {
        res.locals.cartCount = Number(rows?.[0]?.count || 0);
        next();
      })
      .catch(() => {
        res.locals.cartCount = 0;
        next();
      });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/__health', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.redirect(302, '/templates'));

  app.use(createWebRouter());

  return app;
}
