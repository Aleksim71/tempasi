'use strict';

const crypto = require('crypto');

let getPool;
try {
  ({ getPool } = require('../../scripts/db.pool.cjs'));
} catch (e1) {
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

function devAuthEnabled() {
  return !isProd() && (process.env.DEV_AUTH === '1' || process.env.ALLOW_DEV_USER === '1');
}

function getDevUserIdFromReq(req) {
  const raw =
    (typeof req.get === 'function' ? req.get('x-dev-user-id') : req.headers['x-dev-user-id']) || '';
  const v = String(raw).trim();
  if (!v) return null;

  const id = Number(v);
  if (!Number.isFinite(id) || id <= 0) return null;

  return id;
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
  if (req.user !== undefined) return;

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

  req.user = { id };
}

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
 * Gate middleware.
 * DEV override is handled HERE to guarantee it always works.
 */
async function requireAuth(req, res, next) {
  try {
    // ✅ DEV AUTH OVERRIDE — FIRST
    if (devAuthEnabled()) {
      const devId = getDevUserIdFromReq(req);
      if (devId) {
        req.user = { id: devId };
        return next();
      }
    }

    // normal flow
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
  newSessionId,
  setSessionCookie,
  clearSessionCookie,
  initAuth,
  requireAuth,
};
