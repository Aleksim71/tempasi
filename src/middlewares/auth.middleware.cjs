'use strict';

// src/middlewares/auth.middleware.cjs
// CJS auth middleware + cookie helpers.
// MUST NEVER HANG: always next().

const crypto = require('crypto');

// Pool helper (same pattern used elsewhere)
let getPool;
try {
  ({ getPool } = require('../../scripts/db.pool.cjs'));
} catch (e1) {
  try {
    ({ getPool } = require('../db.pool.cjs'));
  } catch (e2) {
    const err = new Error(
      `DB_POOL_HELPER_NOT_FOUND: tried ../../scripts/db.pool.cjs and ../db.pool.cjs; last: ${
        e2?.message || e2
      }`,
    );
    err.cause = e2;
    throw err;
  }
}

/* =========================
   Cookie helpers
   ========================= */

function newSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Determine if request is effectively HTTPS.
 * Works correctly behind reverse-proxy when X-Forwarded-Proto is set.
 */
function isHttpsRequest(req) {
  if (!req) return false;

  if (req.secure) return true;

  const xfp = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (xfp === 'https') return true;

  return false;
}

function setSessionCookie(req, res, sid, opts = {}) {
  const maxAgeSeconds = Number(opts.maxAgeSeconds || 60 * 60 * 24 * 30);

  const parts = [
    `sid=${encodeURIComponent(String(sid))}`,
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];

  // Secure ONLY when request is HTTPS (prod behind proxy safe)
  if (process.env.NODE_ENV === 'production' && isHttpsRequest(req)) {
    parts.push('Secure');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [
    'sid=',
    'Max-Age=0',
    'Path=/',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (process.env.NODE_ENV === 'production' && isHttpsRequest(req)) {
    parts.push('Secure');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

function parseSid(req) {
  const cookie = String(req.headers.cookie || '');
  const sidMatch = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  return sidMatch ? decodeURIComponent(sidMatch[1]) : '';
}

/* =========================
   Timeout helper
   ========================= */

const OP_TIMEOUT_MS = Number(process.env.AUTH_OP_TIMEOUT_MS || 2500);

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_resolve, reject) => {
    t = setTimeout(() => {
      const err = new Error(`AUTH_TIMEOUT: ${label} exceeded ${ms}ms`);
      err.code = 'AUTH_TIMEOUT';
      reject(err);
    }, ms);
    if (t && typeof t.unref === 'function') t.unref();
  });

  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

/* =========================
   Auth middleware
   ========================= */

/**
 * initAuth() -> middleware
 * Sets:
 *   req.user (object|null)
 *   req.userId (number|null)
 *
 * Key hardening:
 * - Resolve userId from sessions table ONLY (fast).
 * - Optional join to users.
 * - NEVER throws, NEVER hangs.
 */
function initAuth() {
  return async function authMiddleware(req, _res, next) {
    try {
      req.user = null;
      req.userId = null;

      const sid = parseSid(req);
      if (!sid) return next();

      const pool = getPool();

      const qSid = pool.query(
        `
        SELECT user_id
        FROM sessions
        WHERE id = $1
          AND expires_at > NOW()
        LIMIT 1
        `,
        [sid],
      );

      const sidRes = await withTimeout(qSid, OP_TIMEOUT_MS, 'db:sessions lookup');
      const userId = sidRes?.rows?.[0]?.user_id;

      if (!userId) return next();

      req.userId = Number(userId);

      try {
        const qUser = pool.query(
          `
          SELECT id, email, role, status
          FROM users
          WHERE id = $1
          LIMIT 1
          `,
          [userId],
        );

        const { rows } = await withTimeout(qUser, OP_TIMEOUT_MS, 'db:users lookup');
        if (rows && rows[0]) req.user = rows[0];
      } catch {
        // ignore user lookup failures
      }

      return next();
    } catch {
      req.user = null;
      req.userId = null;
      return next();
    }
  };
}

/**
 * requireAuth middleware for API routes
 */
function requireAuth(req, res, next) {
  const uid = (req.user && req.user.id) || req.userId;
  if (uid) return next();

  return res.status(401).json({
    ok: false,
    error: {
      code: 'AUTH_REQUIRED',
      message: 'Нужна авторизация.',
      field: null,
      meta: {},
    },
  });
}

module.exports = {
  initAuth,
  requireAuth,

  newSessionId,
  setSessionCookie,
  clearSessionCookie,
};
