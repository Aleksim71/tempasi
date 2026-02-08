'use strict';

/**
 * src/modules/auth/passwordReset.routes.cjs
 *
 * POST /forgot-password
 * POST /reset-password
 *
 * Works for:
 * - SSR (HTML forms): redirects with ?ok=1 / ?e=AUTH_*
 * - API (JSON): returns JSON {ok:true} or {error:{code,message}}
 *
 * IMPORTANT:
 * - Never reveal whether email exists.
 * - On success:
 *   - forgot → 303 /forgot-password?ok=1
 *   - reset  → 303 /login?ok=1
 */

const express = require('express');
const crypto = require('node:crypto');

// Pool helper (same pattern as auth.routes.cjs)
let getPool;
try {
  ({ getPool } = require('../../../scripts/db.pool.cjs'));
} catch (_e1) {
  try {
    ({ getPool } = require('../../db.pool.cjs'));
  } catch (_e2) {
    getPool = null;
  }
}

// bcrypt (prefer bcrypt, fallback bcryptjs)
function getBcrypt() {
  try {
    return require('bcrypt');
  } catch (_) {
    try {
      return require('bcryptjs');
    } catch (e2) {
      const err = new Error('PASSWORD_HASHER_NOT_FOUND');
      err.cause = e2;
      throw err;
    }
  }
}
const bcrypt = getBcrypt();

const router = express.Router();

/* =========================
   Config
   ========================= */

const OP_TIMEOUT_MS = Number(process.env.AUTH_OP_TIMEOUT_MS || 4000);
const RESET_TOKEN_TTL_SECONDS = Number(process.env.RESET_TOKEN_TTL_SECONDS || 60 * 60); // 1 hour
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

// If set, used to build reset link in logs.
// Otherwise falls back to req headers (host).
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim();

/* =========================
   Body parser
   ========================= */

const parseBody = [express.urlencoded({ extended: false }), express.json()];

/* =========================
   Helpers
   ========================= */

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_r, reject) => {
    t = setTimeout(() => {
      const err = new Error(`AUTH_TIMEOUT: ${label} exceeded ${ms}ms`);
      err.code = 'AUTH_TIMEOUT';
      reject(err);
    }, ms);
    if (t && typeof t.unref === 'function') t.unref();
  });

  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return { ok: false, message: 'Password must be at least 8 characters.' };
  if (s.length > 200) return { ok: false, message: 'Password is too long.' };
  return { ok: true };
}

function wantsHtml(req) {
  return req.accepts(['html', 'json']) === 'html';
}

function safeNext(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (!s.startsWith('/')) return '';
  if (s.startsWith('//')) return '';
  if (s.includes('\\')) return '';
  if (s.length > 512) return '';
  if (s.toLowerCase().includes('http://')) return '';
  if (s.toLowerCase().includes('https://')) return '';
  return s;
}

function buildBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function makeToken() {
  // 32 bytes -> 64 hex chars
  return crypto.randomBytes(32).toString('hex');
}

function sendJsonError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function redirectForgotOk(req, res) {
  const next = safeNext(req.body?.next) || safeNext(req.query?.next) || '';
  const qs = new URLSearchParams();
  qs.set('ok', '1');
  if (next) qs.set('next', next);
  return res.redirect(303, `/forgot-password?${qs.toString()}`);
}

function redirectResetError(req, res, code, token) {
  const qs = new URLSearchParams();
  if (token) qs.set('token', String(token));
  qs.set('e', code);
  return res.redirect(303, `/reset-password?${qs.toString()}`);
}

function redirectLoginOk(res) {
  return res.redirect(303, '/login?ok=1');
}

function isLikelyExpiredTokenError(err) {
  // We mark explicit codes below; keep helper for fallback
  const msg = String(err?.message || '');
  return msg.toLowerCase().includes('expired');
}

/* =========================
   Token store (DB with fallback to memory)
   ========================= */

// Memory fallback (MVP/dev): tokenHash -> { userId, expiresAtMs, usedAtMs }
const memTokens = new Map();

// Candidate table strategies (we try in order, ignoring "undefined_table")
const TOKEN_TABLES = [
  {
    name: 'password_resets',
    insertSql: `
      INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at)
      VALUES ($1, $2::bigint, NOW(), NOW() + ($3 || ' seconds')::interval, NULL)
    `,
    selectSql: `
      SELECT token_hash, user_id, expires_at, used_at
      FROM password_resets
      WHERE token_hash = $1
      LIMIT 1
    `,
    markUsedSql: `
      UPDATE password_resets
      SET used_at = NOW()
      WHERE token_hash = $1 AND used_at IS NULL
    `,
    deleteUserTokensSql: `
      DELETE FROM password_resets
      WHERE user_id = $1::bigint
    `,
  },
  {
    name: 'password_reset_tokens',
    insertSql: `
      INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at, used_at)
      VALUES ($1, $2::bigint, NOW(), NOW() + ($3 || ' seconds')::interval, NULL)
    `,
    selectSql: `
      SELECT token_hash, user_id, expires_at, used_at
      FROM password_reset_tokens
      WHERE token_hash = $1
      LIMIT 1
    `,
    markUsedSql: `
      UPDATE password_reset_tokens
      SET used_at = NOW()
      WHERE token_hash = $1 AND used_at IS NULL
    `,
    deleteUserTokensSql: `
      DELETE FROM password_reset_tokens
      WHERE user_id = $1::bigint
    `,
  },
  {
    name: 'reset_tokens',
    insertSql: `
      INSERT INTO reset_tokens (token_hash, user_id, created_at, expires_at, used_at)
      VALUES ($1, $2::bigint, NOW(), NOW() + ($3 || ' seconds')::interval, NULL)
    `,
    selectSql: `
      SELECT token_hash, user_id, expires_at, used_at
      FROM reset_tokens
      WHERE token_hash = $1
      LIMIT 1
    `,
    markUsedSql: `
      UPDATE reset_tokens
      SET used_at = NOW()
      WHERE token_hash = $1 AND used_at IS NULL
    `,
    deleteUserTokensSql: `
      DELETE FROM reset_tokens
      WHERE user_id = $1::bigint
    `,
  },
];

async function tryDbInsertToken(pool, tokenHash, userId, ttlSeconds) {
  for (const t of TOKEN_TABLES) {
    try {
      await pool.query(t.insertSql, [tokenHash, userId, String(ttlSeconds)]);
      return { ok: true, table: t.name };
    } catch (err) {
      if (err && err.code === '42P01') continue; // undefined_table
      // if schema mismatch, try next (best-effort)
      if (err && (err.code === '42703' || err.code === '42883')) continue; // undefined_column / undefined_function
      throw err;
    }
  }
  return { ok: false };
}

async function tryDbSelectToken(pool, tokenHash) {
  for (const t of TOKEN_TABLES) {
    try {
      const { rows } = await pool.query(t.selectSql, [tokenHash]);
      if (rows && rows[0]) return { ok: true, table: t.name, row: rows[0] };
      return { ok: true, table: t.name, row: null };
    } catch (err) {
      if (err && err.code === '42P01') continue;
      if (err && (err.code === '42703' || err.code === '42883')) continue;
      throw err;
    }
  }
  return { ok: false };
}

async function tryDbMarkUsed(pool, tokenHash) {
  for (const t of TOKEN_TABLES) {
    try {
      await pool.query(t.markUsedSql, [tokenHash]);
      return { ok: true, table: t.name };
    } catch (err) {
      if (err && err.code === '42P01') continue;
      if (err && (err.code === '42703' || err.code === '42883')) continue;
      throw err;
    }
  }
  return { ok: false };
}

async function tryDbDeleteUserTokens(pool, userId) {
  for (const t of TOKEN_TABLES) {
    try {
      await pool.query(t.deleteUserTokensSql, [userId]);
      return { ok: true, table: t.name };
    } catch (err) {
      if (err && err.code === '42P01') continue;
      if (err && (err.code === '42703' || err.code === '42883')) continue;
      throw err;
    }
  }
  return { ok: false };
}

async function storeResetToken({ userId, ttlSeconds }) {
  const token = makeToken();
  const tokenHash = sha256Hex(token);

  // Prefer DB if available
  if (getPool) {
    const pool = getPool();
    const inserted = await withTimeout(
      tryDbInsertToken(pool, tokenHash, userId, ttlSeconds),
      OP_TIMEOUT_MS,
      'db:insert reset token',
    );
    if (inserted.ok) return { token, tokenHash, storage: `db:${inserted.table}` };
  }

  // Fallback: memory
  memTokens.set(tokenHash, {
    userId: Number(userId),
    expiresAtMs: Date.now() + ttlSeconds * 1000,
    usedAtMs: null,
  });

  return { token, tokenHash, storage: 'mem' };
}

async function loadResetToken(token) {
  const tokenHash = sha256Hex(token);

  if (getPool) {
    const pool = getPool();
    const found = await withTimeout(
      tryDbSelectToken(pool, tokenHash),
      OP_TIMEOUT_MS,
      'db:select reset token',
    );
    if (found.ok) {
      const row = found.row;
      if (!row) return { ok: true, tokenHash, data: null, storage: `db:${found.table}` };
      return {
        ok: true,
        tokenHash,
        storage: `db:${found.table}`,
        data: {
          userId: Number(row.user_id),
          expiresAt: row.expires_at, // Date-like
          usedAt: row.used_at,
        },
      };
    }
  }

  const rec = memTokens.get(tokenHash);
  if (!rec) return { ok: true, tokenHash, data: null, storage: 'mem' };
  return {
    ok: true,
    tokenHash,
    storage: 'mem',
    data: {
      userId: Number(rec.userId),
      expiresAtMs: Number(rec.expiresAtMs),
      usedAtMs: rec.usedAtMs ? Number(rec.usedAtMs) : null,
    },
  };
}

async function markTokenUsed(tokenHash, storage, userId) {
  if (storage && storage.startsWith('db:') && getPool) {
    const pool = getPool();
    await withTimeout(tryDbMarkUsed(pool, tokenHash), OP_TIMEOUT_MS, 'db:mark reset used');
    // optional cleanup of other tokens for that user (best-effort)
    await withTimeout(tryDbDeleteUserTokens(pool, userId), OP_TIMEOUT_MS, 'db:cleanup reset tokens');
    return;
  }

  const rec = memTokens.get(tokenHash);
  if (rec) {
    rec.usedAtMs = Date.now();
    // cleanup other tokens for same user (best-effort)
    for (const [k, v] of memTokens) {
      if (v.userId === userId) memTokens.delete(k);
    }
  }
}

/* =========================
   Core operations
   ========================= */

async function findActiveUserIdByEmail(email) {
  if (!getPool) return null;
  const pool = getPool();

  const { rows } = await withTimeout(
    pool.query(
      `SELECT id, status FROM users WHERE email = $1::citext LIMIT 1`,
      [email],
    ),
    OP_TIMEOUT_MS,
    'db:select user by email',
  );

  const u = rows && rows[0];
  if (!u) return null;
  if (String(u.status) !== 'active') return null;
  return Number(u.id);
}

async function updateUserPasswordAndRevokeSessions(userId, newPassword) {
  if (!getPool) throw new Error('DB_POOL_HELPER_NOT_FOUND');
  const pool = getPool();

  const hash = await withTimeout(
    bcrypt.hash(newPassword, BCRYPT_ROUNDS),
    OP_TIMEOUT_MS,
    'bcrypt:hash new password',
  );

  await withTimeout(
    pool.query(
      `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1::bigint`,
      [userId, hash],
    ),
    OP_TIMEOUT_MS,
    'db:update user password',
  );

  // Revoke all sessions (force re-login everywhere)
  await withTimeout(
    pool.query(`DELETE FROM sessions WHERE user_id = $1::bigint`, [userId]),
    OP_TIMEOUT_MS,
    'db:delete user sessions',
  );
}

/* =========================
   Routes
   ========================= */

// POST /forgot-password
router.post('/forgot-password', parseBody, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);

    // Validate email format minimally (don’t leak; just UI-level guidance)
    // If empty/invalid → show "invalid email" for SSR or 400 for JSON
    const isValidEmail = email && email.includes('@') && email.length <= 320;

    if (!isValidEmail) {
      if (wantsHtml(req)) {
        // SSR: redirect back with code (page will show banner)
        return res.redirect(303, '/forgot-password?e=AUTH_INVALID_EMAIL');
      }
      return sendJsonError(res, 400, 'AUTH_INVALID_EMAIL', 'Enter a valid email address.');
    }

    // Never reveal existence.
    // If user exists: create token + log link (dev) + still return ok
    // If user does not exist: still return ok
    let userId = null;
    try {
      userId = await findActiveUserIdByEmail(email);
    } catch (err) {
      // DB errors should NOT leak; treat as ok in SSR, but log / pass to error handler in JSON?
      // Here: keep SSR ok; for JSON, return timeout/misconfig.
      if (!wantsHtml(req)) throw err;
    }

    if (userId) {
      const { token, storage } = await storeResetToken({
        userId,
        ttlSeconds: RESET_TOKEN_TTL_SECONDS,
      });

      const base = buildBaseUrl(req);
      const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;

      // MVP: log link (replace with email sender later)
      // Avoid noisy prod logs
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log(`[auth] password reset link (${storage}) for ${email}: ${link}`);
      }
    }

    if (wantsHtml(req)) {
      // Always same UX
      return redirectForgotOk(req, res);
    }
    return res.json({ ok: true });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      if (wantsHtml(req)) return redirectForgotOk(req, res); // still OK UX
      return sendJsonError(res, 504, 'AUTH_TIMEOUT', 'Request timed out. Try again.');
    }
    return next(err);
  }
});

// POST /reset-password
router.post('/reset-password', parseBody, async (req, res, next) => {
  try {
    const token = String(req.body?.token || req.query?.token || '').trim();
    const password = String(req.body?.password || '');

    // Validate input
    if (!token) {
      if (wantsHtml(req)) return redirectResetError(req, res, 'AUTH_RESET_TOKEN_INVALID', '');
      return sendJsonError(res, 400, 'AUTH_RESET_TOKEN_INVALID', 'Reset token is required.');
    }

    const pw = validatePassword(password);
    if (!pw.ok) {
      if (wantsHtml(req)) {
        // Keep token in query so page can keep context
        return redirectResetError(req, res, 'AUTH_PASSWORD_WEAK', token);
      }
      return sendJsonError(res, 400, 'AUTH_PASSWORD_WEAK', pw.message || 'Password is too weak.');
    }

    // Load token
    const loaded = await loadResetToken(token);
    const data = loaded.data;

    if (!data) {
      if (wantsHtml(req)) return redirectResetError(req, res, 'AUTH_RESET_TOKEN_INVALID', token);
      return sendJsonError(res, 400, 'AUTH_RESET_TOKEN_INVALID', 'This reset link is invalid.');
    }

    // Check used / expired (support both db-date and mem-ms)
    const used =
      data.usedAt != null ||
      data.usedAtMs != null;

    if (used) {
      if (wantsHtml(req)) return redirectResetError(req, res, 'AUTH_RESET_TOKEN_INVALID', token);
      return sendJsonError(res, 400, 'AUTH_RESET_TOKEN_INVALID', 'This reset link is invalid.');
    }

    let expired = false;
    if (data.expiresAtMs != null) {
      expired = Date.now() > Number(data.expiresAtMs);
    } else if (data.expiresAt) {
      expired = Date.now() > new Date(data.expiresAt).getTime();
    }

    if (expired) {
      if (wantsHtml(req)) return redirectResetError(req, res, 'AUTH_RESET_TOKEN_EXPIRED', token);
      return sendJsonError(res, 400, 'AUTH_RESET_TOKEN_EXPIRED', 'This reset link has expired.');
    }

    const userId = Number(data.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      if (wantsHtml(req)) return redirectResetError(req, res, 'AUTH_RESET_TOKEN_INVALID', token);
      return sendJsonError(res, 400, 'AUTH_RESET_TOKEN_INVALID', 'This reset link is invalid.');
    }

    // Update password + revoke sessions (DB required)
    if (!getPool) {
      if (wantsHtml(req)) return redirectResetError(req, res, 'AUTH_TIMEOUT', token);
      return sendJsonError(res, 500, 'DB_POOL_HELPER_NOT_FOUND', 'Server misconfigured.');
    }

    await updateUserPasswordAndRevokeSessions(userId, password);

    // Mark token used + cleanup
    await markTokenUsed(loaded.tokenHash, loaded.storage, userId);

    if (wantsHtml(req)) {
      return redirectLoginOk(res);
    }
    return res.json({ ok: true });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      if (wantsHtml(req)) return redirectResetError(req, res, 'AUTH_TIMEOUT', String(req.body?.token || ''));
      return sendJsonError(res, 504, 'AUTH_TIMEOUT', 'Request timed out. Try again.');
    }
    if (isLikelyExpiredTokenError(err)) {
      if (wantsHtml(req)) return redirectResetError(req, res, 'AUTH_RESET_TOKEN_EXPIRED', String(req.body?.token || ''));
      return sendJsonError(res, 400, 'AUTH_RESET_TOKEN_EXPIRED', 'This reset link has expired.');
    }
    return next(err);
  }
});

module.exports = {
  passwordResetRouter: router,
};
