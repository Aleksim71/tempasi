// src/web/routes/web.routes.js
import express from 'express';
import { createTemplatesRouter } from './templates.routes.js';

/**
 * Factory: create the main SSR web router.
 * app.web.js imports { createWebRouter } from './web/routes/web.routes.js'
 */
export function createWebRouter() {
  const router = express.Router();

  // Dedicated templates routes (GET /templates etc.)
  router.use(createTemplatesRouter());

  // ---- Other pages (keep or extend as needed) ----
  // If you already have routes for '/', '/contact', '/profile', etc.,
  // add them here (or paste them back in).
  //
  // router.get('/', (req, res) => res.render('pages/home', { layout: 'main' }));

  return router;
}
