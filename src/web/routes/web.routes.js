// src/web/routes/web.routes.js
import { Router } from 'express';

import { createTemplatesRouter } from './templates.routes.js';
import { createTemplatePreviewRouter } from './templatePreview.routes.js';
import { createAuthPagesRouter } from './auth.pages.routes.js';
import { createCartRouter } from './cart.routes.js';

export function createWebRouter() {
  const router = Router();

  // Home -> templates catalog
  router.get('/', (_req, res) => res.redirect(302, '/templates'));

  // Static content pages (public, no auth required)
  router.get('/about', (_req, res) => {
    res.render('pages/static/about', {
      title: 'About',
      bodyClass: 'page-static',
      activePage: 'about',
      styles: ['/css/pages/static-content.css'],
    });
  });

  router.get('/functionality', (_req, res) => {
    res.render('pages/static/functionality', {
      title: 'How Tempasi works',
      bodyClass: 'page-static',
      activePage: 'functionality',
      styles: ['/css/pages/static-content.css'],
    });
  });

  // Provider identification (§ 5 DDG). Content is a structural placeholder
  // until real details (name, address, contact) are supplied — see
  // src/web/views/pages/static/impressum.hbs.
  router.get('/impressum', (_req, res) => {
    res.render('pages/static/impressum', {
      title: 'Impressum',
      bodyClass: 'page-static',
      activePage: 'impressum',
      styles: ['/css/pages/static-content.css'],
    });
  });

  // Template usage rights (Buy/Rent). Real first-draft content, not a
  // placeholder — but explicitly marked "pending legal review" and with
  // one open business decision flagged (Rent expiry mid-project) — see
  // src/web/views/pages/static/license.hbs.
  router.get('/license', (_req, res) => {
    res.render('pages/static/license', {
      title: 'Template License',
      bodyClass: 'page-static',
      activePage: 'license',
      styles: ['/css/pages/static-content.css'],
    });
  });

  // Auth pages (SSR): /login, /logout, etc.
  // IMPORTANT: auth.pages.routes.js defines routes like router.get('/login'...)
  // so we mount it at root.
  router.use('/', createAuthPagesRouter());

  // Public preview endpoint (backward-compatible with /t/<slug>/preview.png)
  router.use('/t', createTemplatePreviewRouter());

  router.use('/cart', createCartRouter());

  // Public catalog + details
  router.use('/templates', createTemplatesRouter());

  return router;
}

export default {
  createWebRouter,
};
