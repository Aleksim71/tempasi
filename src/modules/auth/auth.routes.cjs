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

const { clearSessionCookie, newSessionId, setSessionCookie } = require('../../middlewares/auth.middleware.cjs');

const router = express.Router();

function isDev() {
  return process.env.NODE_ENV !== 'production';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return { ok: false, message: 'Password must be at least 8 characters' };
  if (s.length > 200) return { ok: false, message: 'Password is too long' };
  return { ok: true };
}

function parseSid(req) {
  const cookie = String(req.headers.cookie || '');
  const sidMatch = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  return sidMatch ? decodeURIComponent(sidMatch[1]) : '';
}

// ---- password hashing (bcrypt preferred) ----
function getBcrypt() {
  try {
    // eslint-disable-next-line global-require
    return require('bcrypt');
  } catch (_) {
    try {
      // eslint-disable-next-line global-require
      return require('bcryptjs');
    } catch (e2) {
      const err = new Error('PASSWORD_HASHER_NOT_FOUND: install "bcrypt" or "bcryptjs"');
      err.cause = e2;
      throw err;
    }
  }
}

const bcrypt = getBcrypt();
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

// ---- timeouts (diagnostic hardening) ----
const OP_TIMEOUT_MS = Number(process.env.AUTH_OP_TIMEOUT_MS || 4000);

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_resolve, reject) => {
    t = setTimeout(() => {
      const err = new Error(`AUTH_TIMEOUT: ${label} exceeded ${ms}ms`);
      err.code = 'AUTH_TIMEOUT';
      reject(err);
    }, ms);
    // don't keep process alive
    if (t && typeof t.unref === 'function') t.unref();
  });

  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

async function createSessionForUser(userId) {
  const sid = newSessionId();
  const maxAgeSeconds = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 30);

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

// ---------- REAL AUTH ----------

// Register: creates user and logs in (session + cookie)
router.post('/register', express.json(), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'email is required' } });
    }

    const pwOk = validatePassword(password);
    if (!pwOk.ok) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: pwOk.message } });
    }

    // 1) hash (can hang if hasher blocks)
    const passwordHash = await withTimeout(
      Promise.resolve(bcrypt.hash(password, BCRYPT_ROUNDS)),
      OP_TIMEOUT_MS,
      'bcrypt:hash',
    );

    // 2) insert user (can hang if DB/pool blocks)
    const pool = getPool();
    let userId;

    try {
      const q = pool.query(
        `
        INSERT INTO users (email, password_hash, status, role, created_at, updated_at)
        VALUES ($1::citext, $2, 'active', 'user', NOW(), NOW())
        RETURNING id
        `,
        [email, passwordHash],
      );

      const { rows } = await withTimeout(q, OP_TIMEOUT_MS, 'db:insert user');
      userId = rows?.[0]?.id;
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({
          error: { code: 'EMAIL_TAKEN', message: 'Email is already registered' },
        });
      }
      throw err;
    }

    // 3) session + cookie
    const { sid, maxAgeSeconds } = await createSessionForUser(userId);
    setSessionCookie(res, sid, { maxAgeSeconds });

    return res.status(201).json({
      ok: true,
      userId: String(userId),
      _ms: Date.now() - startedAt,
    });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      return res.status(504).json({
        error: { code: 'TIMEOUT', message: err.message },
      });
    }
    return next(err);
  }
});

// Login: checks password -> session + cookie
router.post('/login', express.json(), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'email and password are required' },
      });
    }

    const pool = getPool();
    const { rows } = await withTimeout(
      pool.query(
        `
        SELECT id, password_hash, status
        FROM users
        WHERE email = $1::citext
        LIMIT 1
        `,
        [email],
      ),
      OP_TIMEOUT_MS,
      'db:select user',
    );

    const u = rows && rows[0];
    if (!u) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      });
    }

    if (String(u.status) !== 'active') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'User is not active' },
      });
    }

    const ok = await withTimeout(
      Promise.resolve(bcrypt.compare(password, String(u.password_hash || ''))),
      OP_TIMEOUT_MS,
      'bcrypt:compare',
    );

    if (!ok) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      });
    }

    const { sid, maxAgeSeconds } = await createSessionForUser(u.id);
    setSessionCookie(res, sid, { maxAgeSeconds });

    return res.status(200).json({
      ok: true,
      userId: String(u.id),
      _ms: Date.now() - startedAt,
    });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      return res.status(504).json({
        error: { code: 'TIMEOUT', message: err.message },
      });
    }
    return next(err);
  }
});

// Me: reads current session -> returns user basic info
router.get('/me', async (req, res, next) => {
  try {
    const sid = parseSid(req);
    if (!sid) return res.status(200).json({ ok: true, user: null });

    const pool = getPool();
    const { rows } = await withTimeout(
      pool.query(
        `
        SELECT u.id, u.email, u.role, u.status
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.id = $1
          AND s.expires_at > NOW()
        LIMIT 1
        `,
        [sid],
      ),
      OP_TIMEOUT_MS,
      'db:me join',
    );

    if (!rows || rows.length === 0) return res.status(200).json({ ok: true, user: null });
    return res.status(200).json({ ok: true, user: rows[0] });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      return res.status(504).json({
        error: { code: 'TIMEOUT', message: err.message },
      });
    }
    return next(err);
  }
});

// DEV-only: create a real cookie session for a given user id.
// ✅ Guarantee the user exists in DB (tests often start from empty DB).
router.post('/dev-login', express.json(), async (req, res, next) => {
  try {
    if (!isDev()) return res.status(404).send('Not found');

    const userIdRaw = String(req.body?.userId || '').trim();
    const userId = Number(userIdRaw);

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'userId must be a positive number' },
      });
    }

    const pool = getPool();

    // Ensure user exists (id-based), so auth JOIN can succeed
    const devEmail = `dev-${userId}@tempasi.local`;

    await withTimeout(
      pool.query(
        `
        INSERT INTO users (id, email, password_hash, status, role, created_at, updated_at)
        VALUES ($1::bigint, $2::citext, $3, 'active', 'user', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        `,
        [userId, devEmail, 'DEV_LOGIN'],
      ),
      OP_TIMEOUT_MS,
      'db:dev-login ensure user',
    );

    const sid = newSessionId();
    const maxAgeSeconds = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 30);

    await withTimeout(
      pool.query(
        `
        INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
        VALUES ($1, $2::bigint, NOW(), NOW(), NOW() + ($3 || ' seconds')::interval)
        `,
        [sid, userId, String(maxAgeSeconds)],
      ),
      OP_TIMEOUT_MS,
      'db:dev-login insert session',
    );

    setSessionCookie(res, sid, { maxAgeSeconds });
    return res.status(200).json({ ok: true, userId: String(userId) });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      return res.status(504).json({
        error: { code: 'TIMEOUT', message: err.message },
      });
    }
    return next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const sid = parseSid(req);

    if (sid) {
      const pool = getPool();
      await withTimeout(pool.query(`DELETE FROM sessions WHERE id = $1`, [sid]), OP_TIMEOUT_MS, 'db:logout delete');
    }

    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      return res.status(504).json({
        error: { code: 'TIMEOUT', message: err.message },
      });
    }
    return next(err);
  }
});

module.exports = {
  authRouter: router,
};
