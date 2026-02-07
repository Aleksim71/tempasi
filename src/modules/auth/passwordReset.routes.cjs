// src/modules/auth/passwordReset.routes.cjs
/* eslint-env node */
'use strict';

const express = require('express');
const crypto = require('node:crypto');

const router = express.Router();

// ---------- helpers: content negotiation ----------
function wantsHtml(req) {
  // Treat normal browser form posts as HTML.
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/html')) return true;
  // If it's a classic form POST, content-type is urlencoded.
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/x-www-form-urlencoded')) return true;
  // Default: assume HTML for GET in browser
  if (req.method === 'GET') return true;
  return false;
}

// ---------- helpers: timeouts ----------
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_resolve, reject) => {
    t = setTimeout(() => {
      const err = new Error(`AUTH_TIMEOUT:${label}`);
      err.code = 'AUTH_TIMEOUT';
      reject(err);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

const OP_TIMEOUT_MS = Number(process.env.AUTH_OP_TIMEOUT_MS || 2500);

// ---------- db pool helper ----------
let getPool;
try {
  ({ getPool } = require('../../scripts/db.pool.cjs'));
} catch (_e1) {
  try {
    ({ getPool } = require('../db.pool.cjs'));
  } catch (_e2) {
    getPool = null;
  }
}

// ---------- password hashing ----------
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

// ---------- email normalization ----------
function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

// ---------- view model (IMPORTANT) ----------
function authViewBase() {
  // This is what makes auth.css apply and prevents layout scroll regressions.
  return {
    styles: ['/css/pages/auth.css'],
    bodyClass: 'auth',
    hideHeader: false,
  };
}

// ---------- routes ----------
router.use(express.urlencoded({ extended: false }));
router.use(express.json({ limit: '32kb' }));

// GET /forgot-password
router.get('/forgot-password', async (req, res, next) => {
  try {
    if (wantsHtml(req)) {
      return res.status(200).render('pages/forgot-password', {
        ...authViewBase(),
        title: 'Forgot password',
        ok: false,
        email: '',
        errors: null,
        note: null,
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// POST /forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const errors = [];
    if (!email) errors.push('Email is required');

    // Always respond "ok" to avoid user enumeration, but in HTML show validation errors.
    if (errors.length) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/forgot-password', {
          ...authViewBase(),
          title: 'Forgot password',
          ok: false,
          email,
          errors,
          note: null,
        });
      }
      return res.status(200).json({ ok: true });
    }

    if (!getPool) {
      if (wantsHtml(req)) {
        return res.status(200).render('pages/forgot-password', {
          ...authViewBase(),
          title: 'Forgot password',
          ok: true,
          email: '',
          errors: null,
          note: 'If that email exists, we sent a reset link.',
        });
      }
      return res.status(200).json({ ok: true });
    }

    const pool = getPool();

    // 1) find user
    const qUser = pool.query(
      `
      SELECT id, status
      FROM users
      WHERE email = $1::citext
      LIMIT 1
      `,
      [email],
    );

    const { rows } = await withTimeout(qUser, OP_TIMEOUT_MS, 'db:find user');
    const user = rows && rows[0];

    // Always pretend success
    if (!user || String(user.status) !== 'active') {
      if (wantsHtml(req)) {
        return res.status(200).render('pages/forgot-password', {
          ...authViewBase(),
          title: 'Forgot password',
          ok: true,
          email: '',
          errors: null,
          note: 'If that email exists, we sent a reset link.',
        });
      }
      return res.status(200).json({ ok: true });
    }

    // 2) create token + store hash
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const ttlMinutes = Number(process.env.PASSWORD_RESET_TTL_MIN || 30);

    const qIns = pool.query(
      `
      INSERT INTO password_resets (user_id, token_hash, expires_at, created_at)
      VALUES ($1::bigint, $2, NOW() + ($3 || ' minutes')::interval, NOW())
      `,
      [user.id, tokenHash, String(ttlMinutes)],
    );

    await withTimeout(qIns, OP_TIMEOUT_MS, 'db:insert reset');

    // 3) send email (in dev we can log link)
    const appOrigin = String(process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`);
    const resetUrl = `${appOrigin}/reset-password?token=${token}`;
    console.log('[auth] password reset link:', resetUrl);

    if (wantsHtml(req)) {
      return res.status(200).render('pages/forgot-password', {
        ...authViewBase(),
        title: 'Forgot password',
        ok: true,
        email: '',
        errors: null,
        note: 'If that email exists, we sent a reset link.',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      if (wantsHtml(req)) {
        return res.status(200).render('pages/forgot-password', {
          ...authViewBase(),
          title: 'Forgot password',
          ok: true,
          email: '',
          errors: null,
          note: 'If that email exists, we sent a reset link.',
        });
      }
      return res.status(200).json({ ok: true });
    }
    return next(err);
  }
});

// GET /reset-password
router.get('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.query?.token || '').trim();

    if (wantsHtml(req)) {
      return res.status(200).render('pages/reset-password', {
        ...authViewBase(),
        title: 'Reset password',
        ok: false,
        token,
        errors: null,
        note: null,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// POST /reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body?.token || req.query?.token || '').trim();
    const newPassword = String(req.body?.password || '');
    const newPassword2 = String(req.body?.password2 || '');

    const errors = [];
    if (!token) errors.push('Token is required');
    if (!newPassword) errors.push('Password is required');
    if (newPassword.length < 8) errors.push('Password must be at least 8 characters');
    if (newPassword !== newPassword2) errors.push('Passwords do not match');

    if (errors.length) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ...authViewBase(),
          title: 'Reset password',
          ok: false,
          token,
          errors,
          note: null,
        });
      }
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION', errors } });
    }

    if (!getPool) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ...authViewBase(),
          title: 'Reset password',
          ok: false,
          token,
          errors: ['Server misconfigured'],
          note: null,
        });
      }
      return res.status(500).json({ ok: false, error: { code: 'MISCONFIG' } });
    }

    const pool = getPool();

    // 1) hash token and find row
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const qFind = pool.query(
      `
      SELECT id, user_id, expires_at, used_at
      FROM password_resets
      WHERE token_hash = $1
      LIMIT 1
      `,
      [tokenHash],
    );

    const { rows } = await withTimeout(qFind, OP_TIMEOUT_MS, 'db:find reset');
    const row = rows && rows[0];

    if (!row) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ...authViewBase(),
          title: 'Reset password',
          ok: false,
          token,
          errors: ['Invalid or expired token'],
          note: null,
        });
      }
      return res.status(400).json({ ok: false, error: { code: 'INVALID_TOKEN' } });
    }

    if (row.used_at) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ...authViewBase(),
          title: 'Reset password',
          ok: false,
          token,
          errors: ['Token already used'],
          note: null,
        });
      }
      return res.status(400).json({ ok: false, error: { code: 'TOKEN_USED' } });
    }

    const exp = new Date(row.expires_at);
    if (Number.isFinite(exp.getTime()) && exp.getTime() < Date.now()) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ...authViewBase(),
          title: 'Reset password',
          ok: false,
          token,
          errors: ['Invalid or expired token'],
          note: null,
        });
      }
      return res.status(400).json({ ok: false, error: { code: 'EXPIRED' } });
    }

    // 2) hash new password
    const passwordHash = await withTimeout(
      bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      OP_TIMEOUT_MS,
      'bcrypt:hash',
    );

    // 3) transaction: update user password + mark token used + revoke sessions
    const client = await withTimeout(pool.connect(), OP_TIMEOUT_MS, 'db:connect');

    try {
      await withTimeout(client.query('BEGIN'), OP_TIMEOUT_MS, 'db:begin');

      await withTimeout(
        client.query(
          `
          UPDATE users
          SET password_hash = $1, updated_at = NOW()
          WHERE id = $2::bigint
          `,
          [passwordHash, row.user_id],
        ),
        OP_TIMEOUT_MS,
        'db:update password',
      );

      await withTimeout(
        client.query(
          `
          UPDATE password_resets
          SET used_at = NOW()
          WHERE id = $1
          `,
          [row.id],
        ),
        OP_TIMEOUT_MS,
        'db:mark token used',
      );

      await withTimeout(
        client.query(`DELETE FROM sessions WHERE user_id = $1`, [row.user_id]),
        OP_TIMEOUT_MS,
        'db:revoke sessions',
      );

      await withTimeout(client.query('COMMIT'), OP_TIMEOUT_MS, 'db:commit');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw e;
    } finally {
      client.release();
    }

    if (wantsHtml(req)) {
      return res.status(200).render('pages/reset-password', {
        ...authViewBase(),
        title: 'Reset password',
        ok: true,
        token: '',
        errors: null,
        note: 'Password updated. Please sign in.',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ...authViewBase(),
          title: 'Reset password',
          ok: false,
          token: String(req.body?.token || '').trim(),
          errors: ['Reset failed. Try again.'],
          note: null,
        });
      }
      return res.status(500).json({ ok: false, error: { code: 'TIMEOUT' } });
    }
    return next(err);
  }
});

module.exports = { passwordResetRouter: router };
