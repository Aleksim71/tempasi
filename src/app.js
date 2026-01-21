// src/app.js
import express from 'express';
import { createWebApp } from './app.web.js';

/**
 * Единственный контракт:
 * - createWebApp(opts) -> express app (mini-app)
 * - главный app монтирует web через app.use(webApp)
 *
 * Никаких createWebApp(app) "мутаторов".
 */
export function createApp() {
  const app = express();

  // базовые middleware (до web)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // WEB (SSR) — должен жить независимо
  const webApp = createWebApp({ services: {} });
  app.use(webApp);

  // 404 (в самом конце)
  app.use((req, res) => {
    res.status(404).type('text').send('Not found');
  });

  return app;
}
