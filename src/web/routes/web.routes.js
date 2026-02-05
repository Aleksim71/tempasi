// src/web/routes/web.routes.js
import { Router } from 'express';

import { createTemplatesRouter } from './templates.routes.js';
import { createPreviewProxyRouter } from './preview-proxy.routes.js';
import { createAuthPagesRouter } from './auth.pages.routes.js';

export function createWebRouter() {
  const router = Router();

  // ✅ ВАЖНО: прокси должен быть РАНЬШЕ страниц,
  // чтобы картинки/превью не ловили 404 от Express
  router.use(createPreviewProxyRouter());

  // Auth pages (GET /login, GET /register, etc.)
  // Должно стоять ДО /templates, чтобы страницы авторизации
  // не пересекались с шаблонами/маршрутами каталога.
  router.use(createAuthPagesRouter());

  // UX: корень сайта → каталог
  router.get('/', (_req, res) => res.redirect(302, '/templates'));

  // /templates (catalog + template pages)
  router.use('/templates', createTemplatesRouter());

  return router;
}
