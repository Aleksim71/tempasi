'use strict';

const crypto = require('crypto');

// B13.1: pool helper lives in scripts/db.pool.cjs in this repo.
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
      `DB_POOL_HELPER_NOT_FOUND: tried ../../scripts/db.pool.cjs and ../db.pool.cjs; last: ${
        e2?.message || e2
      }`
    );
    err.cause = e2;
    throw err;
  }
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function isDev() {
  return process.env.NODE_ENV !== 'production';
}

function jsonAuthError(res, code, message) {
  return res.status(401).json({
    error: {
      code,
      message,
    },
  });
}

async function loadUserFromSession(req, _res, next) {
  try {
    const cookies = parseCookieHeader(req.headers.cookie || '');
    const sid = cookies.sid;

    if (!sid) {
      req.user = null;
      return next();
    }

    const pool = getPool();
    const now = new Date();

    const { rows } = await pool.query(
      `
      SELECT s.id, s.user_id, s.expires_at
      FROM sessions s
      WHERE s.id = $1
      LIMIT 1
      `,
      [sid]
    );

    if (!rows.length) {
      req.user = null;
      return next();
    }

    const s = rows[0];
    if (s.expires_at && new Date(s.expires_at) <= now) {
      req.user = null;
      return next();
    }

    req.user = { id: String(s.user_id) };

    // Touch last_seen_at (best-effort)
    try {
      await pool.query(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`, [sid]);
    } catch (_) {
      // ignore
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

function requireAuth(req, res, next) {
  if (req.user && req.user.id) return next();

  // Helpful dev hint: if app forgot to mount loadUserFromSession.
  if (isDev() && typeof req.user === 'undefined') {
    return jsonAuthError(
      res,
      'AUTH_REQUIRED',
      'Auth middleware not initialized (req.user is undefined)'
    );
  }

  return jsonAuthError(res, 'AUTH_REQUIRED', 'Authentication required');
}

function setSessionCookie(res, sid, { maxAgeSeconds } = {}) {
  const maxAge = Number.isFinite(maxAgeSeconds)
    ? Math.max(0, Math.floor(maxAgeSeconds))
    : 60 * 60 * 24 * 30;

  const parts = [
    `sid=${encodeURIComponent(sid)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
  ];

  if (process.env.NODE_ENV === 'production') parts.push('Secure');

  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`sid=`, `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=0`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function newSessionId() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = {
  loadUserFromSession,
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
  newSessionId,
};
