// src/web/middleware/require-auth.web.js
// ESM middleware for SSR pages: redirects to /login when user is not authenticated.
//
// Dev toggle:
//   TEMPASI_SKIP_AUTH=1  -> bypass this guard (useful for SSR development)

function safeNextPath(input) {
  const raw = String(input || '').trim();

  if (!raw) return '';
  if (raw.length > 512) return '';
  if (!raw.startsWith('/')) return '';
  if (raw.startsWith('//')) return '';
  if (raw.includes('\\')) return '';
  if (raw.toLowerCase().includes('http://')) return '';
  if (raw.toLowerCase().includes('https://')) return '';

  return raw;
}

export function requireAuthWeb(options = {}) {
  const loginPath = options.loginPath || '/login';
  const defaultNext = options.defaultNext || '/templates';

  return function requireAuthWebMiddleware(req, res, next) {
    // ✅ DEV BYPASS (critical for local SSR work)
    if (process.env.TEMPASI_SKIP_AUTH) return next();

    // "Logged in" heuristics (supports multiple auth setups)
    const isAuthed = Boolean(
      req.user ||
      req.auth?.user ||
      req.auth?.userId ||
      req.session?.user ||
      req.session?.userId ||
      req.session?.uid ||
      req.userId,
    );

    if (isAuthed) return next();

    // If this is an API/XHR call, prefer 401 instead of redirect
    const accept = String(req.headers?.accept || '');
    const wantsJson =
      accept.includes('application/json') ||
      req.xhr ||
      String(req.headers?.['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';

    if (wantsJson) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authorization required.',
          field: null,
          meta: {},
        },
      });
    }

    const original = req.originalUrl || req.url || '';
    const safeNext = safeNextPath(original) || safeNextPath(defaultNext) || '/templates';

    const sep = loginPath.includes('?') ? '&' : '?';
    return res.redirect(302, `${loginPath}${sep}next=${encodeURIComponent(safeNext)}`);
  };
}
