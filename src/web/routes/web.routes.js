// src/web/routes/web.routes.js
import { Router } from 'express';

import { createTemplatesRouter } from './templates.routes.js';
import { createTemplatePreviewRouter } from './templatePreview.routes.js';
import { createAuthPagesRouter } from './auth.pages.routes.js';

export function createWebRouter() {
  const router = Router();

  // Home -> templates catalog
  router.get('/', (_req, res) => res.redirect(302, '/templates'));

  // Auth pages (SSR): /login, /logout, etc.
  // IMPORTANT: auth.pages.routes.js defines routes like router.get('/login'...)
  // so we mount it at root.
  router.use('/', createAuthPagesRouter());

  // Public preview endpoint (backward-compatible with /t/<slug>/preview.png)
  router.use('/t', createTemplatePreviewRouter());

  // Public catalog + details
  router.use('/templates', createTemplatesRouter());

  return router;
}

export default {
  createWebRouter,
};
