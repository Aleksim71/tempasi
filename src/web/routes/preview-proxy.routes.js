// src/web/routes/preview-proxy.routes.js
import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

export function createPreviewProxyRouter() {
  const router = Router();

  const target = process.env.PREVIEW_ORIGIN || 'http://192.168.0.249';
  const hostHeader = process.env.PREVIEW_HOST || 'preview.tempasi.test';

  router.use(
    '/t',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      secure: false,
      logLevel: 'warn',

      // ✅ критично: Express "срезает" /t при mount'е, возвращаем его обратно
      pathRewrite: (path) => `/t${path}`,

      headers: {
        Host: hostHeader,
      },
    }),
  );

  return router;
}
