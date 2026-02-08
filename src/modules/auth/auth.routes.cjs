'use strict';

const express = require('express');

// B13.1: pool helper lives in scripts/db.pool.cjs.
// auth.routes is in src/modules/auth/, so relative path is ../../../scripts/db.pool.cjs
let getPool;
try {
  ({ getPool } = require('../../../scripts/db.pool.cjs'));
} catch (e1) {
  // fallback (older layout)
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

const {
  clearSessionCookie,
  newSessionId,
  setSessionCookie,
} = require('../../middlewares/auth.middleware.cjs');

const router = express.Router();

/* =========================
   Config
   ========================= */

// Remember me (MVP): short vs long session TTL
const TTL_SHORT_SECONDS = Number(process.env.SESSION_TTL_SHORT_SECONDS || 60 * 60 * 2); // 2 hours
const TTL_REMEMBER_SECONDS = Number(process.env.SESSION_TTL_REMEMBER_SECONDS || 60 * 60 * 24 * 30); // 30 days

// Login rate-limit (MVP, in-memory)
// Defaults: 10 attempts per 10 minutes per (ip + email)
const LOGIN_RL_WINDOW_SECONDS = Number(process.env.LOGIN_RL_WINDOW_SECONDS || 10 * 60);
const LOGIN_RL_MAX_ATTEMPTS = Number(process.env.LOGIN_RL_MAX_ATTEMPTS || 10);
const LOGIN_RL_KEY_MODE = String(process.env.LOGIN_RL_KEY_MODE || 'ip_email'); // ip | ip_email

// Proxy/IP hardening
const TRUST_PROXY = String(process.env.TRUST_PROXY || '').trim() === '1';
const TRUST_PROXY_IPS = String(process.env.TRUST_PROXY_IPS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ---- timeouts ----
const OP_TIMEOUT_MS = Number(process.env.AUTH_OP_TIMEOUT_MS || 4000);

/* =========================
   Helpers
   ========================= */

function isDev() {
  return process.env.NODE_ENV !== 'production';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'on', 'yes'].includes(v.toLowerCase());
  return false;
}

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return { ok: false, message: 'Password must be at least 8 characters.' };
  if (s.length > 200) return { ok: false, message: 'Password is too long.' };
  return { ok: true };
}

function parseSid(req) {
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function wantsHtml(req) {
  return req.accepts(['html', 'json']) === 'html';
}

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

function pickNext(req) {
  return safeNextPath(req.body?.next) || safeNextPath(req.query?.next) || '/templates';
}

function pickSessionTtlSeconds(req) {
  return parseBool(req.body?.remember) ? TTL_REMEMBER_SECONDS : TTL_SHORT_SECONDS;
}

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

/* =========================
   Auth error helpers (API + optional HTML redirect)
   ========================= */

function jsonAuthError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function redirectAuthError(req, res, pagePath, code) {
  // For HTML form posts, redirect back to the page with ?e=CODE and preserve next.
  const next = safeNextPath(req.body?.next) || safeNextPath(req.query?.next) || '';
  const qs = new URLSearchParams();
  qs.set('e', code);
  if (next) qs.set('next', next);
  return res.redirect(303, `${pagePath}?${qs.toString()}`);
}

function sendAuthError(req, res, status, code, message, pagePathForHtml) {
  if (wantsHtml(req) && pagePathForHtml) {
    return redirectAuthError(req, res, pagePathForHtml, code);
  }
  return jsonAuthError(res, status, code, message);
}

function sendTimeout(req, res) {
  // Keep JSON stable; if HTML, you can later route to a generic error page.
  return sendAuthError(
    req,
    res,
    504,
    'AUTH_TIMEOUT',
    'Request timed out. Try again.',
    null,
  );
}

/* =========================
   Crypto
   ========================= */

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
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

/* =========================
   Sessions
   ========================= */

async function createSessionForUser(userId, maxAgeSeconds) {
  const sid = newSessionId();
  const pool = getPool();

  await withTimeout(
    pool.query(
      `
      INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
      VALUES ($1, $2::bigint, NOW(), NOW(), NOW() + ($3 || ' seconds')::interval)
      `,
      [sid, userId, String(maxAgeSeconds)],
    ),
    OP_TIMEOUT_MS,
    'db:insert session',
  );

  return { sid, maxAgeSeconds };
}

async function rotateSession(req) {
  const sid = parseSid(req);
  if (!sid) return;
  const pool = getPool();
  await withTimeout(
    pool.query(`DELETE FROM sessions WHERE id = $1`, [sid]),
    OP_TIMEOUT_MS,
    'db:rotate delete',
  );
}

/* =========================
   Body parser
   ========================= */

const parseBody = [express.urlencoded({ extended: false }), express.json()];

/* =========================
   Login rate limit (in-memory)
   ========================= */

const loginAttempts = new Map();

function nowMs() {
  return Date.now();
}

function getClientIp(req) {
  const directIp =
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'unknown';

  if (!TRUST_PROXY) return directIp;

  if (TRUST_PROXY_IPS.length > 0 && !TRUST_PROXY_IPS.includes(String(directIp))) {
    return directIp;
  }

  const xff = String(req.headers['x-forwarded-for'] || '').trim();
  if (!xff) return directIp;
  return xff.split(',')[0].trim() || directIp;
}

function makeLoginKey(req, email) {
  const ip = getClientIp(req);
  const e = normalizeEmail(email);
  return LOGIN_RL_KEY_MODE === 'ip' ? `ip:${ip}` : `ip:${ip}|email:${e || 'empty'}`;
}

function checkAndBumpLoginRateLimit(req, email) {
  const key = makeLoginKey(req, email);
  const ms = nowMs();
  const windowMs = LOGIN_RL_WINDOW_SECONDS * 1000;

  const entry = loginAttempts.get(key);
  if (!entry || ms >= entry.resetAtMs) {
    loginAttempts.set(key, { count: 1, resetAtMs: ms + windowMs });
    return { ok: true };
  }

  if (entry.count >= LOGIN_RL_MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAtMs - ms) / 1000) };
  }

  entry.count += 1;
  return { ok: true };
}

function cleanupLoginRateLimitMap() {
  const ms = nowMs();
  for (const [k, v] of loginAttempts) {
    if (ms >= v.resetAtMs + 60_000) loginAttempts.delete(k);
  }
}

/* =========================
   Routes
   ========================= */

// register
router.post('/register', parseBody, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email) {
      return sendAuthError(
        req,
        res,
        400,
        'AUTH_INVALID_INPUT',
        'Check the form fields and try again.',
        '/register',
      );
    }

    const pw = validatePassword(password);
    if (!pw.ok) {
      // map to AUTH_PASSWORD_WEAK (and keep message short)
      return sendAuthError(
        req,
        res,
        400,
        'AUTH_PASSWORD_WEAK',
        pw.message || 'Password must be at least 8 characters.',
        '/register',
      );
    }

    const hash = await withTimeout(
      bcrypt.hash(password, BCRYPT_ROUNDS),
      OP_TIMEOUT_MS,
      'bcrypt:hash',
    );

    const pool = getPool();
    let userId;

    try {
      const { rows } = await withTimeout(
        pool.query(
          `
          INSERT INTO users (email, password_hash, status, role, created_at, updated_at)
          VALUES ($1::citext, $2, 'active', 'user', NOW(), NOW())
          RETURNING id
          `,
          [email, hash],
        ),
        OP_TIMEOUT_MS,
        'db:insert user',
      );
      userId = rows[0].id;
    } catch (err) {
      if (err.code === '23505') {
        return sendAuthError(
          req,
          res,
          409,
          'AUTH_EMAIL_TAKEN',
          'This email is already in use.',
          '/register',
        );
      }
      throw err;
    }

    await rotateSession(req);
    const maxAgeSeconds = pickSessionTtlSeconds(req);
    const { sid } = await createSessionForUser(userId, maxAgeSeconds);
    setSessionCookie(res, sid, { maxAgeSeconds });

    return wantsHtml(req)
      ? res.redirect(303, pickNext(req))
      : res.status(201).json({ ok: true, userId: String(userId) });
  } catch (err) {
    if (err.code === 'AUTH_TIMEOUT') return sendTimeout(req, res);
    return next(err);
  }
});

// login
router.post('/login', parseBody, async (req, res, next) => {
  try {
    cleanupLoginRateLimitMap();

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return sendAuthError(
        req,
        res,
        400,
        'AUTH_INVALID_INPUT',
        'Enter your email and password.',
        '/login',
      );
    }

    const rl = checkAndBumpLoginRateLimit(req, email);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return sendAuthError(
        req,
        res,
        429,
        'AUTH_TOO_MANY_ATTEMPTS',
        'Too many attempts. Try again later.',
        '/login',
      );
    }

    const pool = getPool();
    const { rows } = await withTimeout(
      pool.query(
        `SELECT id, password_hash, status FROM users WHERE email=$1::citext LIMIT 1`,
        [email],
      ),
      OP_TIMEOUT_MS,
      'db:select user',
    );

    const u = rows[0];
    if (!u || u.status !== 'active') {
      // do NOT reveal whether email exists
      return sendAuthError(
        req,
        res,
        401,
        'AUTH_INVALID_CREDENTIALS',
        'Incorrect email or password.',
        '/login',
      );
    }

    const ok = await withTimeout(
      bcrypt.compare(password, u.password_hash),
      OP_TIMEOUT_MS,
      'bcrypt:compare',
    );

    if (!ok) {
      return sendAuthError(
        req,
        res,
        401,
        'AUTH_INVALID_CREDENTIALS',
        'Incorrect email or password.',
        '/login',
      );
    }

    loginAttempts.delete(makeLoginKey(req, email));

    await rotateSession(req);
    const maxAgeSeconds = pickSessionTtlSeconds(req);
    const { sid } = await createSessionForUser(u.id, maxAgeSeconds);
    setSessionCookie(res, sid, { maxAgeSeconds });

    return wantsHtml(req)
      ? res.redirect(303, pickNext(req))
      : res.status(200).json({ ok: true, userId: String(u.id) });
  } catch (err) {
    if (err.code === 'AUTH_TIMEOUT') return sendTimeout(req, res);
    return next(err);
  }
});

// me
router.get('/me', async (req, res, next) => {
  try {
    const sid = parseSid(req);
    if (!sid) return res.json({ ok: true, user: null });

    const pool = getPool();
    const { rows } = await withTimeout(
      pool.query(
        `
        SELECT u.id, u.email, u.role, u.status
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > NOW()
        LIMIT 1
        `,
        [sid],
      ),
      OP_TIMEOUT_MS,
      'db:me',
    );

    return res.json({ ok: true, user: rows[0] || null });
  } catch (err) {
    if (err.code === 'AUTH_TIMEOUT') return sendTimeout(req, res);
    return next(err);
  }
});

// dev-login
router.post('/dev-login', parseBody, async (req, res, next) => {
  try {
    if (!isDev()) return res.status(404).end();

    const userId = Number(req.body?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return jsonAuthError(res, 400, 'AUTH_INVALID_INPUT', 'Bad request.');
    }

    const pool = getPool();
    await withTimeout(
      pool.query(
        `
        INSERT INTO users (id, email, password_hash, status, role, created_at, updated_at)
        VALUES ($1, $2::citext, 'DEV', 'active', 'user', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        `,
        [userId, `dev-${userId}@tempasi.local`],
      ),
      OP_TIMEOUT_MS,
      'db:dev ensure user',
    );

    await rotateSession(req);
    const maxAgeSeconds = pickSessionTtlSeconds(req);
    const sid = newSessionId();

    await withTimeout(
      pool.query(
        `
        INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
        VALUES ($1, $2::bigint, NOW(), NOW(), NOW() + ($3 || ' seconds')::interval)
        `,
        [sid, userId, String(maxAgeSeconds)],
      ),
      OP_TIMEOUT_MS,
      'db:dev insert session',
    );

    setSessionCookie(res, sid, { maxAgeSeconds });
    return res.json({ ok: true, userId: String(userId) });
  } catch (err) {
    if (err.code === 'AUTH_TIMEOUT') return sendTimeout(req, res);
    return next(err);
  }
});

// logout (current session)
router.post('/logout', async (req, res, next) => {
  try {
    const sid = parseSid(req);
    if (sid) {
      const pool = getPool();
      await withTimeout(
        pool.query(`DELETE FROM sessions WHERE id = $1`, [sid]),
        OP_TIMEOUT_MS,
        'db:logout',
      );
    }

    clearSessionCookie(res);
    return wantsHtml(req)
      ? res.redirect(303, '/templates')
      : res.json({ ok: true });
  } catch (err) {
    if (err.code === 'AUTH_TIMEOUT') return sendTimeout(req, res);
    return next(err);
  }
});

// 🔐 logout-all (revoke ALL sessions)
router.post('/logout-all', async (req, res, next) => {
  try {
    const sid = parseSid(req);
    if (!sid) {
      clearSessionCookie(res);
      return res.status(204).end();
    }

    const pool = getPool();
    await withTimeout(
      pool.query(
        `
        DELETE FROM sessions
        WHERE user_id = (
          SELECT user_id FROM sessions WHERE id = $1
        )
        `,
        [sid],
      ),
      OP_TIMEOUT_MS,
      'db:logout-all',
    );

    clearSessionCookie(res);
    return res.status(204).end();
  } catch (err) {
    if (err.code === 'AUTH_TIMEOUT') return sendTimeout(req, res);
    return next(err);
  }
});

module.exports = {
  authRouter: router,
};
