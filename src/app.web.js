// src/app.web.js
import express from 'express';
import path from 'node:path';
import hbs from 'hbs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWebRouter } from './web/routes/web.routes.js';

import cartCheckoutPassRoutes from './web/routes/cart.checkout-pass.routes.js';

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

  // TEMPASI_TEMPLATE_STORED_PREVIEW_ROUTE
  // Serve real stored template preview extracted from template upload storage.
  app.get('/t/:slug/preview/preview.:ext', (req, res) => {
    const slug = String(req.params.slug || '').trim();
    const ext = String(req.params.ext || '')
      .trim()
      .toLowerCase();

    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
      return res.status(404).send('Not found');
    }

    if (!/^(png|jpg|jpeg|webp|svg)$/.test(ext)) {
      return res.status(404).send('Not found');
    }

    const uploadRoots = [
      process.env.TEMPLATE_UPLOAD_DIR,
      process.env.UPLOAD_DIR,
      path.join(process.cwd(), 'uploads', 'templates'),
      path.join(process.cwd(), 'public', 'uploads', 'templates'),
    ].filter(Boolean);

    for (const root of uploadRoots) {
      const resolvedRoot = path.resolve(root);
      const candidate = path.resolve(resolvedRoot, slug, 'preview', `preview.${ext}`);

      if (!candidate.startsWith(resolvedRoot + path.sep)) {
        continue;
      }

      if (fs.existsSync(candidate)) {
        if (ext === 'svg') {
          res.type('image/svg+xml');
        }

        return res.sendFile(candidate);
      }
    }

    return res.status(404).send('Not found');
  });

  // TEMPASI_TEMPLATES_DEMO_STATIC_ROUTE (2026-08-04)
  // Serves "Live Demo" content (src/index.html, assets/*.css,
  // src/*.js, etc.) directly from TEMPLATE_UPLOAD_DIR/<slug>/ —
  // the same directory the preview route above already reads from,
  // and the same directory the seller upload flow now extracts the
  // FULL zip contents into (see extractFullTemplateToUploadDir in
  // templateZip.contract.cjs), not just the preview PNG.
  //
  // This REPLACES the previous design (a separate, isolated
  // templates-demo.server.js process on its own port, proxied here
  // via http-proxy-middleware). That process/proxy is gone —
  // decided together with the user: template files are already
  // isolated by living on a physically separate machine
  // (TEMPLATE_UPLOAD_DIR is an sshfs-style mount to that machine),
  // so a second local process added no real isolation, just extra
  // moving parts (a port to remember to start, a proxy to keep in
  // sync). The files are static HTML/CSS/JS — nothing here ever
  // executes server-side, so serving them directly is not a
  // code-execution risk the way running the process was framed to
  // guard against.
  //
  // Path-traversal guarded the same way as the preview route: resolve
  // and confirm the final path is still inside
  // TEMPLATE_UPLOAD_DIR/<slug>/ before sending. The uploaded .zip
  // itself is NEVER reachable through this route — it's stored as a
  // flat, randomly-named file directly under TEMPLATE_UPLOAD_DIR
  // (not inside any <slug>/ folder), so it can never match this
  // route's /t/:slug/* shape.
  app.get('/t/:slug/*rest', (req, res) => {
    const slug = String(req.params.slug || '').trim();
    // Express 5 / path-to-regexp v7+: a named wildcard like *rest
    // gives an ARRAY of path segments (e.g. ['src','assets',
    // 'style.css']), not a single string — join it back into a path.
    const restParam = req.params.rest;
    const rest = (Array.isArray(restParam) ? restParam.join('/') : String(restParam || '')).trim();

    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
      return res.status(404).send('Not found');
    }

    if (!rest || rest.includes('..')) {
      return res.status(404).send('Not found');
    }

    const uploadRoots = [
      process.env.TEMPLATE_UPLOAD_DIR,
      process.env.UPLOAD_DIR,
      path.join(process.cwd(), 'uploads', 'templates'),
      path.join(process.cwd(), 'public', 'uploads', 'templates'),
    ].filter(Boolean);

    for (const root of uploadRoots) {
      const resolvedRoot = path.resolve(root);
      const slugRoot = path.resolve(resolvedRoot, slug);
      const candidate = path.resolve(slugRoot, rest);

      if (!candidate.startsWith(slugRoot + path.sep) && candidate !== slugRoot) {
        continue;
      }

      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return res.sendFile(candidate);
      }
    }

    return res.status(404).send('Not found');
  });

  // TEMPASI_USER_AVATAR_ROUTE (2026-08-04)
  // Serve uploaded profile avatars. Same pattern as the template
  // preview route above (dedicated route + path-traversal guard,
  // not express.static — matches this codebase's existing convention
  // for user-uploaded files).
  app.get('/u/:userId/avatar.:ext', (req, res) => {
    const userId = String(req.params.userId || '').trim();
    const ext = String(req.params.ext || '')
      .trim()
      .toLowerCase();

    if (!/^[0-9]+$/.test(userId)) {
      return res.status(404).send('Not found');
    }

    if (!/^(png|jpg|jpeg|webp)$/.test(ext)) {
      return res.status(404).send('Not found');
    }

    const uploadRoots = [
      process.env.AVATAR_UPLOAD_DIR,
      path.join(process.cwd(), 'uploads', 'avatars'),
    ].filter(Boolean);

    for (const root of uploadRoots) {
      const resolvedRoot = path.resolve(root);
      const candidate = path.resolve(resolvedRoot, userId, `avatar.${ext}`);

      if (!candidate.startsWith(resolvedRoot + path.sep)) {
        continue;
      }

      if (fs.existsSync(candidate)) {
        return res.sendFile(candidate);
      }
    }

    return res.status(404).send('Not found');
  });

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
  const pAdminHeader = path.join(partialsRoot, 'admin-header.hbs');
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
  const adminHeader = safeRead(pAdminHeader);
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
  registerPartialSafe('admin-header', adminHeader);
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
  // Backward-compatible legacy preview URL.
  // Old: /preview/:slug
  // New: /templates/:slug/demo
  app.get('/preview/:slug', (req, res) => {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.redirect(302, '/templates');
    return res.redirect(302, `/templates/${encodeURIComponent(slug)}/demo`);
  });

  app.get('/', (_req, res) => res.redirect(302, '/templates'));

  app.use(createWebRouter());

  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.TEMPASI_ENABLE_CART_CHECKOUT_PASS === '1'
  ) {
    app.use(cartCheckoutPassRoutes);
  }

  return app;
}
