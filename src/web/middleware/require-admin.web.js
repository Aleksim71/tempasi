// src/web/middleware/require-admin.web.js
// ESM guard for SSR admin pages (/admin/*).
// Mirrors require-auth.web.js: unauthenticated users are redirected to
// login with a `next` back to the originally requested admin URL;
// authenticated users without an admin/superadmin role get a 403 page
// instead of a redirect, since re-authenticating won't change their role.
//
// Dev toggle (same convention as require-auth.web.js):
//   TEMPASI_SKIP_AUTH=1  -> bypass this guard entirely

const ADMIN_ROLES = new Set(['admin', 'superadmin']);

export function requireAdminWeb(options = {}) {
  const loginPath = options.loginPath || '/login';

  return function requireAdminWebMiddleware(req, res, next) {
    if (process.env.TEMPASI_SKIP_AUTH) return next();

    const userId =
      req?.user?.id ??
      req?.user?.user_id ??
      req?.user?.userId ??
      req?.userId ??
      req?.session?.userId ??
      req?.session?.user_id ??
      null;

    const isAuthed = Boolean(req.user || userId);

    if (!isAuthed) {
      const original = req.originalUrl || req.url || '/admin';
      const safeNext = original.startsWith('/') ? original : '/admin';
      const sep = loginPath.includes('?') ? '&' : '?';
      return res.redirect(302, `${loginPath}${sep}next=${encodeURIComponent(safeNext)}`);
    }

    const role = req.user?.role;
    if (ADMIN_ROLES.has(role)) return next();

    return res.status(403).render('pages/errors/403', {
      title: 'Доступ запрещён',
      bodyClass: 'admin',
    });
  };
}
