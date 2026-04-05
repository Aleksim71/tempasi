// src/web/routes/auth.pages.routes.js
// SSR auth pages (GET) + classic form handlers (POST).
// IMPORTANT: this router is mounted under web app (NOT /api).

import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { newSessionId, setSessionCookie } = require('../../middlewares/auth.middleware.cjs');
const passwordResetMod = require('../../modules/auth/passwordReset.routes.cjs');
const passwordResetRouter =
  (passwordResetMod && passwordResetMod.passwordResetRouter) ||
  (passwordResetMod && passwordResetMod.router) ||
  passwordResetMod;
const {
  createEmailVerification,
  resendEmailVerificationForUser,
  verifyEmailToken,
} = require('../../modules/auth/emailVerification.service.cjs');

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

const TTL_SHORT_SECONDS = Number(process.env.SESSION_TTL_SHORT_SECONDS || 60 * 60 * 2);
const TTL_REMEMBER_SECONDS = Number(process.env.SESSION_TTL_REMEMBER_SECONDS || 60 * 60 * 24 * 30);

const AUTH_UI_MESSAGES = {
  AUTH_INVALID_INPUT: 'Check the form fields and try again.',
  AUTH_INVALID_CREDENTIALS: 'Incorrect email or password.',
  AUTH_TOO_MANY_ATTEMPTS: 'Too many attempts. Try again later.',
  AUTH_EMAIL_TAKEN: 'This email is already in use.',
  AUTH_PASSWORD_WEAK: 'Password must be at least 8 characters.',
  AUTH_TIMEOUT: 'Request timed out. Try again.',
  AUTH_INVALID_EMAIL: 'Enter a valid email address.',
  AUTH_EMAIL_NOT_VERIFIED: 'Please verify your email before signing in.',
  AUTH_RESET_TOKEN_INVALID: 'This reset link is invalid. Request a new one.',
  AUTH_RESET_TOKEN_EXPIRED: 'This reset link has expired. Request a new one.',
  AUTH_VERIFY_TOKEN_INVALID: 'This verification link is invalid. Request a new one.',
  AUTH_VERIFY_TOKEN_EXPIRED: 'This verification link has expired. Request a new one.',
};

function pickAuthError(req) {
  const code = String(req.query?.e || '').trim();
  if (!code) return null;
  const message = AUTH_UI_MESSAGES[code];
  if (!message) return null;
  return { code, message };
}

function pickAuthOk(req) {
  const ok = String(req.query?.ok || '').trim();
  if (!ok) return null;
  if (ok === '1') return { message: 'Done.' };
  if (ok === 'verified') return { message: 'Email verified. You can sign in.' };
  return null;
}

function isFatalResetTokenError(uiErr) {
  if (!uiErr) return false;
  return uiErr.code === 'AUTH_RESET_TOKEN_INVALID' || uiErr.code === 'AUTH_RESET_TOKEN_EXPIRED';
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return { ok: false, message: 'Password must be at least 8 characters.' };
  if (s.length > 200) return { ok: false, message: 'Password is too long.' };
  return { ok: true };
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

function getCurrentUserId(req) {
  return req?.userId || req?.user?.id || req?.user?.user_id || req?.user?.userId || null;
}

async function rotateSession(req) {
  if (!getPool) return;
  const sid = parseSid(req);
  if (!sid) return;
  const pool = getPool();
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [sid]);
}

function redirectWithError(res, pagePath, code, next) {
  const qs = new URLSearchParams();
  qs.set('e', code);
  if (next) qs.set('next', next);
  return res.redirect(303, `${pagePath}?${qs.toString()}`);
}

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
  const uiErr = pickAuthError(req);
  const uiOk = pickAuthOk(req);
  const errors = opts.errors || (uiErr ? [uiErr.message] : null);
  const note = opts.note || (uiOk ? uiOk.message : null);
  return res.status(200).render('pages/login', {
    title: 'Login',
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
    hideFooter: false,
    next,
    email: opts.email || '',
    remember: Boolean(opts.remember),
    note,
    errors,
  });
}

function renderRegister(req, res, opts = {}) {
  const next = safeNext(req.query?.next || req.body?.next);
  const uiErr = pickAuthError(req);
  const uiOk = pickAuthOk(req);
  const errors = opts.errors || (uiErr ? [uiErr.message] : null);
  const note = opts.note || (uiOk ? uiOk.message : null);
  return res.status(200).render('pages/register', {
    title: 'Create account',
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
    hideFooter: false,
    next,
    email: opts.email || '',
    note,
    errors,
  });
}

function renderForgotPassword(req, res, opts = {}) {
  const uiErr = pickAuthError(req);
  const ok = String(req.query?.ok || '').trim() === '1';
  const defaultNote = ok
    ? 'Check your inbox. If the email exists, you’ll receive a link shortly.'
    : null;
  const errors = opts.errors || (uiErr ? [uiErr.message] : null);
  const note = opts.note || defaultNote;
  return res.status(200).render('pages/forgot-password', {
    title: 'Forgot password',
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
    hideFooter: false,
    email: opts.email || '',
    note,
    errors,
  });
}

function renderResetPassword(req, res, opts = {}) {
  const uiErr = pickAuthError(req);
  const ok = String(req.query?.ok || '').trim() === '1';
  const defaultNote = ok ? 'Password updated. You can sign in.' : null;
  const errors = opts.errors || (uiErr ? [uiErr.message] : null);
  const note = opts.note || defaultNote;
  const fatalTokenError = isFatalResetTokenError(uiErr);
  return res.status(200).render('pages/reset-password', {
    title: 'Reset password',
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
    hideFooter: false,
    token: fatalTokenError ? '' : opts.token || '',
    note,
    errors,
    showForm: !fatalTokenError,
  });
}

export function createAuthPagesRouter() {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));

  router.get('/login', (req, res) => {
    if (req.userId) return res.redirect(safeNext(req.query?.next) || '/templates');
    return renderLogin(req, res);
  });

  router.get('/register', (req, res) => {
    if (req.userId) return res.redirect(safeNext(req.query?.next) || '/templates');
    return renderRegister(req, res);
  });

  router.get('/forgot-password', (req, res) => {
    if (req.userId) return res.redirect('/templates');
    return renderForgotPassword(req, res);
  });

  router.get('/reset-password', (req, res) => {
    if (req.userId) return res.redirect('/templates');
    const token = String(req.query?.token || '').trim();
    return renderResetPassword(req, res, { token });
  });

  router.get('/verify-email', async (req, res, next) => {
    try {
      if (!getPool) return redirectWithError(res, '/login', 'AUTH_TIMEOUT', '');
      const token = String(req.query?.token || '').trim();
      const pool = getPool();
      const result = await verifyEmailToken({ db: pool, token });
      if (!result.ok) {
        if (result.error === 'TOKEN_EXPIRED')
          return redirectWithError(res, '/login', 'AUTH_VERIFY_TOKEN_EXPIRED', '');
        return redirectWithError(res, '/login', 'AUTH_VERIFY_TOKEN_INVALID', '');
      }
      return res.redirect(303, '/login?ok=verified');
    } catch (err) {
      return next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const remember = parseBool(req.body?.remember);
      const nextUrl = safeNext(req.body?.next) || '/templates';
      if (!email || !password)
        return redirectWithError(
          res,
          '/login',
          'AUTH_INVALID_INPUT',
          safeNext(req.body?.next) || '',
        );
      if (!getPool)
        return redirectWithError(res, '/login', 'AUTH_TIMEOUT', safeNext(req.body?.next) || '');
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, password_hash, status FROM users WHERE email = $1::citext LIMIT 1`,
        [email],
      );
      const u = rows && rows[0];
      if (!u || String(u.status) !== 'active')
        return redirectWithError(
          res,
          '/login',
          'AUTH_INVALID_CREDENTIALS',
          safeNext(req.body?.next) || '',
        );
      const ok = await bcrypt.compare(password, String(u.password_hash || ''));
      if (!ok)
        return redirectWithError(
          res,
          '/login',
          'AUTH_INVALID_CREDENTIALS',
          safeNext(req.body?.next) || '',
        );
      await rotateSession(req);
      const maxAgeSeconds = remember ? TTL_REMEMBER_SECONDS : TTL_SHORT_SECONDS;
      const { sid } = await createSessionForUser(u.id, maxAgeSeconds);
      setSessionCookie(req, res, sid, { maxAgeSeconds });
      return res.redirect(nextUrl);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/register', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const password2 = String(req.body?.password2 || '');
      if (!email)
        return redirectWithError(
          res,
          '/register',
          'AUTH_INVALID_INPUT',
          safeNext(req.body?.next) || '',
        );
      const pwOk = validatePassword(password);
      if (!pwOk.ok)
        return redirectWithError(
          res,
          '/register',
          'AUTH_PASSWORD_WEAK',
          safeNext(req.body?.next) || '',
        );
      if (password !== password2)
        return redirectWithError(
          res,
          '/register',
          'AUTH_INVALID_INPUT',
          safeNext(req.body?.next) || '',
        );
      if (!getPool)
        return redirectWithError(res, '/register', 'AUTH_TIMEOUT', safeNext(req.body?.next) || '');
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const pool = getPool();
      let userId;
      try {
        const { rows } = await pool.query(
          `
          INSERT INTO users (email, password_hash, email_verified, status, role, created_at, updated_at)
          VALUES ($1::citext, $2, false, 'active', 'user', NOW(), NOW())
          RETURNING id
          `,
          [email, passwordHash],
        );
        userId = rows?.[0]?.id;
      } catch (err) {
        if (err && err.code === '23505')
          return redirectWithError(
            res,
            '/register',
            'AUTH_EMAIL_TAKEN',
            safeNext(req.body?.next) || '',
          );
        throw err;
      }
      await createEmailVerification({ db: pool, userId, email });
      await rotateSession(req);
      const maxAgeSeconds = pickSessionTtlSeconds(req);
      const { sid } = await createSessionForUser(userId, maxAgeSeconds);
      setSessionCookie(req, res, sid, { maxAgeSeconds });
      return res.redirect('/cabinet/profile?tab=profile');
    } catch (err) {
      return next(err);
    }
  });

  router.post('/resend-verification', async (req, res, next) => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) return res.redirect(303, '/login');
      if (!getPool)
        return res.redirect(303, '/cabinet/profile?tab=profile&notice=verification_failed');
      const pool = getPool();
      const result = await resendEmailVerificationForUser({ db: pool, userId });
      if (!result.ok)
        return res.redirect(303, '/cabinet/profile?tab=profile&notice=verification_failed');
      if (result.status === 'already_verified')
        return res.redirect(303, '/cabinet/profile?tab=profile&notice=already_verified');
      return res.redirect(303, '/cabinet/profile?tab=profile&notice=verification_sent');
    } catch (err) {
      return next(err);
    }
  });

  if (typeof passwordResetRouter === 'function' && typeof passwordResetRouter.use === 'function') {
    router.use(passwordResetRouter);
  }

  return router;
}
