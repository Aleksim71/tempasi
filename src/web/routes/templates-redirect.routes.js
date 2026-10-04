// src/web/routes/templates-redirect.routes.js
import { Router } from 'express';

// TEMPASI_TEMPLATES_ORIGIN_REDIRECT (2026-10-04)
// Replaces preview-proxy.routes.js (TEMPASI_PREVIEW_PROXY_RESTORED,
// 2026-08-05) — a conscious reversal, decided together with the user
// for the VPS deploy.
//
// The proxy served seller-uploaded template content (Live Demo HTML/
// JS, preview images including SVG) on the APP's own origin. With
// open registration and no moderation gate on seller_templates, a
// seller's script running in a Live Demo would execute same-origin
// with the app and could send authenticated requests on behalf of
// whoever opened the demo (HttpOnly on `sid` does not prevent that).
//
// Now: when PREVIEW_ORIGIN is set, every /t/* request is redirected
// to that SEPARATE origin (prod: https://templates.web-globus.de),
// path and query preserved. <img> and <iframe> follow redirects, so
// no URL in views/repos has to change. 302, not 301: browsers cache
// 301 indefinitely, which would pin a stale origin if PREVIEW_ORIGIN
// ever changes (e.g. on a dev laptop).
//
// When PREVIEW_ORIGIN is unset/empty, nothing happens here and the
// request falls through to webApp's own /t/:slug/... routes, which
// serve from TEMPLATE_UPLOAD_DIR locally (dev without a storage box,
// tests).
export function resolveTemplatesOrigin(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch (_e) {
    throw new Error(`PREVIEW_ORIGIN_INVALID: not a URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`PREVIEW_ORIGIN_INVALID: unsupported protocol: ${url.protocol}`);
  }
  // Origin only — any path/query in the env value is ignored on purpose.
  return url.origin;
}

export function createTemplatesRedirectRouter({ origin = process.env.PREVIEW_ORIGIN } = {}) {
  const router = Router();
  const target = resolveTemplatesOrigin(origin);

  if (!target) return router;

  router.use('/t', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // originalUrl still carries the /t prefix and the query string.
    return res.redirect(302, target + req.originalUrl);
  });

  return router;
}
