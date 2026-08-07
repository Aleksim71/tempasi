// src/web/routes/preview-proxy.routes.js
import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

// TEMPASI_PREVIEW_PROXY_RESTORED (2026-08-05)
// This is the machine that has always actually served Live Demo and
// catalog preview thumbnails — an nginx server running ON the
// separate "old laptop" storage machine, not the sshfs-style mount
// (TEMPLATE_UPLOAD_DIR) that turned out to have never actually been
// live (confirmed: files there have local-disk timestamps going back
// months, `findmnt` shows nothing mounted). This file existed before
// but was never wired into app.js, and got deleted entirely during a
// refactor that (incorrectly, in hindsight) assumed the mount-based
// approach was the real/working one.
//
// Fixed compared to the original: the original forced a custom
// `Host: preview.tempasi.test` header, which — confirmed via direct
// curl testing against the live nginx — makes it respond 404. nginx
// currently only responds correctly when the Host header matches its
// own address (i.e., no override). Dropped the header override;
// changeOrigin: true already makes http-proxy-middleware set the
// outgoing Host to match the target automatically, which is exactly
// what curl's default (unmodified) Host header did in the working
// test.
export function createPreviewProxyRouter() {
  const router = Router();

  const target = process.env.PREVIEW_ORIGIN || 'http://192.168.0.249';

  router.use(
    '/t',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      secure: false,

      // Express's own path-based router.use('/t', ...) strips '/t'
      // from what this middleware sees before it ever gets here —
      // this restores it before forwarding to the target, which
      // expects the full /t/<slug>/... path. (This part of the
      // original file was already correct.)
      pathRewrite: (path) => `/t${path}`,

      // TEMPASI_PREVIEW_PROXY_ERROR_LOGGING (2026-08-05)
      // Without this, a failed proxy attempt (target unreachable,
      // connection refused, timeout, etc.) just returns a bare 502
      // with NOTHING printed to the server console — confirmed live:
      // a 502 came back but the dev server's own log showed no error
      // at all. v3's error hook lives under `on.error`, not the old
      // top-level `onError`/`logLevel` from v2.
      on: {
        error: (err, req, res) => {
          console.error(
            '[preview-proxy] request failed:',
            req.method,
            req.url,
            '->',
            err.code || err.message,
          );
          if (res && typeof res.writeHead === 'function' && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
          }
          if (res && typeof res.end === 'function') {
            res.end(`Preview proxy error: ${err.code || err.message}`);
          }
        },
      },
    }),
  );

  return router;
}
