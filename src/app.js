// src/app.js
import express from 'express';
import { createWebApp } from './app.web.js';

export function createApp() {
  const app = express();

  // базовые middleware
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // тут можно монтировать API, но даже если оно сломано — web должен жить
  // (оставляю как безопасный “хук”)
  // app.use('/api/orders', ordersRouter);
  // app.use('/api/payments', paymentsRouter);

  createWebApp(app);

  // ✅ healthcheck — ОБЯЗАТЕЛЬНО ДО 404
  app.get('/__health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // 404
  app.use((req, res) => {
    res.status(404).send('Not found');
  });

  return app;
}
