// src/web/routes/web.routes.js
import { Router } from 'express';

import { createTemplatesRouter } from './templates.routes.js';
import { createTemplatePreviewRouter } from './templatePreview.routes.js';
import { createAuthPagesRouter } from './auth.pages.routes.js';
import { createCartRouter } from './cart.routes.js';
import { INFO_PAGES, buildInfoNav } from '../info-pages.js';

export function createWebRouter() {
  const router = Router();

  // Home -> templates catalog
  router.get('/', (_req, res) => res.redirect(302, '/templates'));

  // Info section (public, no auth required): footer pages rendered with
  // the cabinet-style sidebar. Pages, titles and sidebar entries come from
  // src/web/info-pages.js — the single source of truth.
  for (const page of INFO_PAGES) {
    router.get(page.path, (_req, res) => {
      res.render(page.view, {
        title: page.title,
        bodyClass: 'page-static page-info',
        activePage: page.key,
        styles: ['/css/pages/static-content.css', '/css/pages/info.css', ...(page.styles || [])],
        infoNav: buildInfoNav(page.key),
      });
    });
  }

  // Ad-traffic landing page: hero + Studios/Designers sections. Main site
  // header hidden to keep focus on the two CTAs. Reached via direct/ad
  // links; in-site users get the same content at /offers (info section,
  // linked from the footer) — both render partials/landing-content.hbs.
  router.get('/landing', (_req, res) => {
    res.render('pages/landing', {
      title: 'Tempasi — эксклюзивные шаблоны для вебстудий и дизайнеров',
      bodyClass: 'page-landing',
      hideHeader: true,
      styles: ['/css/pages/landing.css'],
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
