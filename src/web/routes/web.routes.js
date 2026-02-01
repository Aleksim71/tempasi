// src/web/routes/web.routes.js
import { Router } from 'express';

import { createTemplatesRouter } from './templates.routes.js';
import { createPreviewProxyRouter } from './preview-proxy.routes.js';
import { createAuthPagesRouter } from './auth.pages.routes.js';

export function createWebRouter() {
  const router = Router();

  // ✅ ВАЖНО: прокси должен быть РАНЬШЕ страниц, чтобы картинки не ловили 404 от Express
  router.use(createPreviewProxyRouter());

  // Auth pages
  router.use(createAuthPagesRouter());

  // /templates
  router.use('/templates', createTemplatesRouter());

  return router;
}
