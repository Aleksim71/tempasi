// src/web/middleware/require-auth.web.js
// ESM middleware for SSR pages: redirects to /login when user is not authenticated.
//
// Dev toggle:
//   TEMPASI_SKIP_AUTH=1  -> bypass this guard (useful for SSR development)

export function requireAuthWeb(options = {}) {
  const loginPath = options.loginPath || '/login';

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
      req.session?.uid,
    );

    if (isAuthed) return next();

    // If this is an API/XHR call, prefer 401 instead of redirect
    const accept = String(req.headers?.accept || '');
    const wantsJson =
      accept.includes('application/json') ||
      req.xhr ||
      String(req.headers?.['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';

    if (wantsJson) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    return res.redirect(loginPath);
  };
}
