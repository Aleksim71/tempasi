// src/web/middleware/require-auth.web.js
// ESM middleware for SSR routes (webApp)
//
// Auth model:
// - cookie: sid=<sessionId>
// - table: sessions(id, user_id, expires_at, ...)

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// DB pool helper (same approach as src/modules/auth/auth.routes.cjs)
let getPool;
try {
  ({ getPool } = require('../../../scripts/db.pool.cjs'));
} catch (e1) {
  try {
    ({ getPool } = require('../../db.pool.cjs'));
  } catch (e2) {
    const err = new Error(
      `DB_POOL_HELPER_NOT_FOUND: tried ../../../scripts/db.pool.cjs and ../../db.pool.cjs; last: ${
        e2?.message || e2
      }`,
    );
    err.cause = e2;
    throw err;
  }
}

function parseSidFromCookieHeader(cookieHeader) {
  const cookie = String(cookieHeader || '');
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export function requireAuthWeb(options = {}) {
  const loginPath = options.loginPath || '/login';

  return async function requireAuthWebMiddleware(req, res, next) {
    try {
      const sid = parseSidFromCookieHeader(req.headers.cookie);

      if (!sid) {
        return res.redirect(302, loginPath);
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `
        SELECT user_id
        FROM sessions
        WHERE id = $1
          AND expires_at > NOW()
        LIMIT 1
        `,
        [sid],
      );

      if (!rows || rows.length === 0) {
        return res.redirect(302, loginPath);
      }

      req.userId = rows[0].user_id;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
