// src/web/routes/auth.pages.routes.js
// SSR auth pages (GET) + classic form handlers (POST).
// IMPORTANT: this router is mounted under web app (NOT /api).

import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Reuse cookie/session helpers from existing auth middleware (CJS)
const { newSessionId, setSessionCookie } = require('../../middlewares/auth.middleware.cjs');

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
  return s;
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

async function createSessionForUser(userId) {
  if (!getPool) throw new Error('DB_POOL_HELPER_NOT_FOUND');
  const sid = newSessionId();
  const maxAgeSeconds = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 30);
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

export function createAuthPagesRouter() {
  const router = express.Router();

  // Parse classic HTML forms
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

  // --- POST /login (form) ---
  router.post('/login', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const remember = Boolean(req.body?.remember);
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

      const { sid, maxAgeSeconds } = await createSessionForUser(u.id);
      setSessionCookie(res, sid, { maxAgeSeconds });

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

      // 1) hash
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // 2) insert user
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

      // 3) session + cookie (auto-login)
      const { sid, maxAgeSeconds } = await createSessionForUser(userId);
      setSessionCookie(res, sid, { maxAgeSeconds });

      return res.redirect(nextUrl);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
