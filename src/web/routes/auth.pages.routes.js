// src/web/routes/auth.pages.routes.js
// SSR auth pages (GET) + classic form handlers (POST).
// IMPORTANT: this router is mounted under web app (NOT /api).

import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Reuse cookie/session helpers from existing auth middleware (CJS)
const { newSessionId, setSessionCookie } = require('../../middlewares/auth.middleware.cjs');

// Mount password reset flow (CJS) into SSR router to avoid duplicating POST logic
// Routes provided by that router (POST):
//   POST /forgot-password
//   POST /reset-password
const passwordResetMod = require('../../modules/auth/passwordReset.routes.cjs');
const passwordResetRouter =
  (passwordResetMod && passwordResetMod.passwordResetRouter) ||
  (passwordResetMod && passwordResetMod.router) ||
  passwordResetMod;

// Use the same pool helper pattern as API auth routes (CJS)
let getPool;
try {
  ({ getPool } = require('../../../scripts/db.pool.cjs'));
} catch (_e1) {
  try {
    ({ getPool } = require('../../db.pool.cjs'));
  } catch (_e2) {
    // If pool helper is missing, handlers will fail fast with 500.
    getPool = null;
  }
}

// Remember me TTL (same as API auth routes)
const TTL_SHORT_SECONDS = Number(process.env.SESSION_TTL_SHORT_SECONDS || 60 * 60 * 2); // 2 hours
const TTL_REMEMBER_SECONDS = Number(process.env.SESSION_TTL_REMEMBER_SECONDS || 60 * 60 * 24 * 30); // 30 days

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return { ok: false, message: 'Password must be at least 8 characters' };
  if (s.length > 200) return { ok: false, message: 'Password is too long' };
  return { ok: true };
}

function safeNext(value) {
  // allow only relative paths, to prevent open redirects
  const s = String(value || '').trim();
  if (!s) return '';
  if (!s.startsWith('/')) return '';
  if (s.startsWith('//')) return '';
  if (s.includes('\\')) return '';
  return s;
}

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'on', 'yes'].includes(v.toLowerCase());
  return false;
}

function pickSessionTtlSeconds(req) {
  const remember = parseBool(req.body?.remember);
  return remember ? TTL_REMEMBER_SECONDS : TTL_SHORT_SECONDS;
}

function parseSid(req) {
  const cookie = String(req.headers.cookie || '');
  const sidMatch = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  return sidMatch ? decodeURIComponent(sidMatch[1]) : '';
}

/**
 * Session rotation (anti-fixation) for SSR form handlers:
 * If request already has a sid cookie, delete that session before issuing a new sid.
 */
async function rotateSession(req) {
  if (!getPool) return;
  const sid = parseSid(req);
  if (!sid) return;
  const pool = getPool();
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [sid]);
}

// ---- password hashing (bcrypt preferred) ----
function getBcrypt() {
  try {
    return require('bcrypt');
  } catch (_) {
    try {
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

async function createSessionForUser(userId, maxAgeSeconds) {
  if (!getPool) throw new Error('DB_POOL_HELPER_NOT_FOUND');

  const sid = newSessionId();
  const pool = getPool();

  await pool.query(
    `
    INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
    VALUES ($1, $2::bigint, NOW(), NOW(), NOW() + ($3 || ' seconds')::interval)
    `,
    [sid, userId, String(maxAgeSeconds)],
  );

  return { sid, maxAgeSeconds };
}

function renderLogin(req, res, opts = {}) {
  const next = safeNext(req.query?.next || req.body?.next);
  return res.status(200).render('pages/login', {
    title: 'Login',
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
    next,
    email: opts.email || '',
    remember: Boolean(opts.remember),
    errors: opts.errors || null,
  });
}

function renderRegister(req, res, opts = {}) {
  const next = safeNext(req.query?.next || req.body?.next);
  return res.status(200).render('pages/register', {
    title: 'Create account',
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
    next,
    email: opts.email || '',
    errors: opts.errors || null,
  });
}

function renderForgotPassword(req, res, opts = {}) {
  return res.status(200).render('pages/forgot-password', {
    title: 'Forgot password',
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
    email: opts.email || '',
    note: opts.note || null,
    errors: opts.errors || null,
  });
}

function renderResetPassword(req, res, opts = {}) {
  return res.status(200).render('pages/reset-password', {
    title: 'Reset password',
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
    token: opts.token || '',
    note: opts.note || null,
    errors: opts.errors || null,
  });
}

export function createAuthPagesRouter() {
  const router = express.Router();

  // Parse classic HTML forms for SSR handlers
  router.use(express.urlencoded({ extended: false }));

  // --- GET pages ---
  router.get('/login', (req, res) => {
    if (req.userId) return res.redirect(safeNext(req.query?.next) || '/templates');
    return renderLogin(req, res);
  });

  router.get('/register', (req, res) => {
    if (req.userId) return res.redirect(safeNext(req.query?.next) || '/templates');
    return renderRegister(req, res);
  });

  // ✅ GET /forgot-password (SSR page)
  router.get('/forgot-password', (req, res) => {
    if (req.userId) return res.redirect('/templates');
    return renderForgotPassword(req, res);
  });

  // ✅ GET /reset-password?token=... (SSR page)
  router.get('/reset-password', (req, res) => {
    if (req.userId) return res.redirect('/templates');
    const token = String(req.query?.token || '').trim();
    // We render even if token missing; POST will validate strictly.
    return renderResetPassword(req, res, { token });
  });

  // --- POST /login (form) ---
  router.post('/login', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const remember = parseBool(req.body?.remember);
      const nextUrl = safeNext(req.body?.next) || '/templates';

      const errors = [];
      if (!email) errors.push('Email is required');
      if (!password) errors.push('Password is required');
      if (errors.length) return renderLogin(req, res, { email, remember, errors });

      if (!getPool)
        return renderLogin(req, res, { email, remember, errors: ['Server misconfigured'] });

      const pool = getPool();
      const { rows } = await pool.query(
        `
        SELECT id, password_hash, status
        FROM users
        WHERE email = $1::citext
        LIMIT 1
        `,
        [email],
      );

      const u = rows && rows[0];
      if (!u)
        return renderLogin(req, res, { email, remember, errors: ['Invalid email or password'] });
      if (String(u.status) !== 'active') {
        return renderLogin(req, res, { email, remember, errors: ['User is not active'] });
      }

      const ok = await bcrypt.compare(password, String(u.password_hash || ''));
      if (!ok)
        return renderLogin(req, res, { email, remember, errors: ['Invalid email or password'] });

      // Session rotation (anti-fixation)
      await rotateSession(req);

      const maxAgeSeconds = remember ? TTL_REMEMBER_SECONDS : TTL_SHORT_SECONDS;
      const { sid } = await createSessionForUser(u.id, maxAgeSeconds);

      // IMPORTANT: cookie helper expects (req, res, sid, opts)
      setSessionCookie(req, res, sid, { maxAgeSeconds });

      return res.redirect(nextUrl);
    } catch (err) {
      return next(err);
    }
  });

  // --- POST /register (form) ---
  router.post('/register', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const password2 = String(req.body?.password2 || '');
      const nextUrl = safeNext(req.body?.next) || '/templates';

      const errors = [];
      if (!email) errors.push('Email is required');

      const pwOk = validatePassword(password);
      if (!pwOk.ok) errors.push(pwOk.message);
      if (password !== password2) errors.push('Passwords do not match');

      if (errors.length) return renderRegister(req, res, { email, errors });
      if (!getPool) return renderRegister(req, res, { email, errors: ['Server misconfigured'] });

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const pool = getPool();
      let userId;

      try {
        const { rows } = await pool.query(
          `
          INSERT INTO users (email, password_hash, status, role, created_at, updated_at)
          VALUES ($1::citext, $2, 'active', 'user', NOW(), NOW())
          RETURNING id
          `,
          [email, passwordHash],
        );
        userId = rows?.[0]?.id;
      } catch (err) {
        if (err && err.code === '23505') {
          return renderRegister(req, res, { email, errors: ['Email is already registered'] });
        }
        throw err;
      }

      // Session rotation (anti-fixation)
      await rotateSession(req);

      const maxAgeSeconds = pickSessionTtlSeconds(req);
      const { sid } = await createSessionForUser(userId, maxAgeSeconds);

      setSessionCookie(req, res, sid, { maxAgeSeconds });

      return res.redirect(nextUrl);
    } catch (err) {
      return next(err);
    }
  });

  // Mount password reset POST endpoints AFTER GET pages
  // So GET /forgot-password and GET /reset-password are handled here (SSR render),
  // while POST /forgot-password and POST /reset-password use the shared CJS router logic.
  if (typeof passwordResetRouter === 'function' && typeof passwordResetRouter.use === 'function') {
    router.use(passwordResetRouter);
  }

  return router;
}
