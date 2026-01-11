'use strict';

const crypto = require('crypto');

// B13.1: pool helper lives in scripts/db.pool.cjs.
// auth.middleware is in src/middlewares/, so relative path is ../../scripts/db.pool.cjs
let getPool;
try {
  ({ getPool } = require('../../scripts/db.pool.cjs'));
} catch (e1) {
  // fallback (older layout)
  try {
    ({ getPool } = require('../db.pool.cjs'));
  } catch (e2) {
    const err = new Error(
      `DB_POOL_HELPER_NOT_FOUND: tried ../../scripts/db.pool.cjs and ../db.pool.cjs; last: ${e2?.message || e2}`
    );
    err.cause = e2;
    throw err;
  }
}

const COOKIE_NAME = 'sid';

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function newSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

function setSessionCookie(res, sid, opts = {}) {
  const maxAgeSeconds = Number(opts.maxAgeSeconds || 60 * 60 * 24 * 30);

  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

function clearSessionCookie(res) {
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
    path: '/',
    maxAge: 0,
  });
}

function getSidFromReq(req) {
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

async function loadUserFromSession(req) {
  // IMPORTANT: distinguish between "not initialized" and "initialized as null"
  if (req.user !== undefined) return;

  // initialize
  req.user = null;

  const sid = getSidFromReq(req);
  if (!sid) return;

  const pool = getPool();
  const q = `
    SELECT user_id
    FROM sessions
    WHERE id = $1
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
  `;
  const r = await pool.query(q, [sid]);
  const row = r.rows && r.rows[0];
  if (!row) return;

  const id = Number(row.user_id);
  if (!Number.isFinite(id) || id <= 0) return;

  // minimal user object
  req.user = { id };
}

/**
 * Global attach middleware (optional): app.use(initAuth)
 * Ensures:
 *  - req.user is either {id} or null (never undefined)
 *  - res.locals.user mirrors req.user for SSR
 */
async function initAuth(req, res, next) {
  try {
    await loadUserFromSession(req);
    res.locals.user = req.user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Gate middleware. MUST work even if app forgot to mount initAuth.
 */
async function requireAuth(req, res, next) {
  try {
    // self-heal: ensure req.user is initialized
    await loadUserFromSession(req);

    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
        },
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  // cookie + sessions helpers used by auth.routes.cjs
  newSessionId,
  setSessionCookie,
  clearSessionCookie,

  // middlewares
  initAuth,
  requireAuth,
};
