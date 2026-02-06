'use strict';

const express = require('express');
const crypto = require('crypto');

let getPool;
try {
  ({ getPool } = require('../../../scripts/db.pool.cjs'));
} catch (e1) {
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

const { sendMail } = require('../../lib/mailer.cjs');

const router = express.Router();

// Accept BOTH: HTML form and JSON API
const parseBody = [express.urlencoded({ extended: false }), express.json()];

const OP_TIMEOUT_MS = Number(process.env.AUTH_OP_TIMEOUT_MS || 4000);
const RESET_TOKEN_TTL_SECONDS = Number(process.env.PASSWORD_RESET_TTL_SECONDS || 60 * 30); // 30 min
const RESET_TOKEN_BYTES = Number(process.env.PASSWORD_RESET_TOKEN_BYTES || 32); // raw bytes
const APP_BASE_URL = String(process.env.APP_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function wantsHtml(req) {
  return req.accepts(['html', 'json']) === 'html';
}

function getClientIp(req) {
  // Keep it simple: we don't need hardened IP here; it's diagnostic only.
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function newRawToken() {
  // URL-safe token
  return crypto.randomBytes(RESET_TOKEN_BYTES).toString('base64url');
}

function buildResetLink(rawToken) {
  return `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Security rule:
 * - Always respond with OK message even if email doesn't exist.
 * - Do not reveal account existence.
 */

// POST /forgot-password  (API + HTML form)
router.post('/forgot-password', parseBody, async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      if (wantsHtml(req)) {
        return res.status(200).render('pages/forgot-password', {
          ok: true,
          note: 'If that email exists, we sent a reset link.',
          email: '',
        });
      }
      return res.status(200).json({ ok: true });
    }

    const pool = getPool();

    // 1) find user id (do not leak if not found)
    const qUser = pool.query(`SELECT id, status FROM users WHERE email = $1::citext LIMIT 1`, [email]);
    const userRes = await withTimeout(qUser, OP_TIMEOUT_MS, 'db:forgot select user');
    const user = userRes?.rows?.[0];

    // Always behave as if success (timing-safe-ish)
    if (!user || String(user.status) !== 'active') {
      // small constant-time jitter (MVP, avoid obvious timing)
      await new Promise((r) => setTimeout(r, 60));
      if (wantsHtml(req)) {
        return res.status(200).render('pages/forgot-password', {
          ok: true,
          note: 'If that email exists, we sent a reset link.',
          email,
          _ms: Date.now() - startedAt,
        });
      }
      return res.status(200).json({ ok: true, _ms: Date.now() - startedAt });
    }

    const rawToken = newRawToken();
    const tokenHash = sha256Hex(rawToken);
    const expiresAtSeconds = RESET_TOKEN_TTL_SECONDS;

    // 2) upsert active token per user (last request wins)
    const qUpsert = pool.query(
      `
      INSERT INTO password_resets (user_id, token_hash, expires_at, request_ip, user_agent)
      VALUES ($1::bigint, $2, NOW() + ($3 || ' seconds')::interval, $4, $5)
      ON CONFLICT ON CONSTRAINT ux_password_resets_user_active
      DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        created_at = NOW(),
        expires_at = EXCLUDED.expires_at,
        used_at = NULL,
        request_ip = EXCLUDED.request_ip,
        user_agent = EXCLUDED.user_agent
      `,
      [
        user.id,
        tokenHash,
        String(expiresAtSeconds),
        String(getClientIp(req)),
        String(req.headers['user-agent'] || ''),
      ],
    );

    await withTimeout(qUpsert, OP_TIMEOUT_MS, 'db:forgot upsert token');

    // 3) send email (or console fallback)
    const link = buildResetLink(rawToken);
    await withTimeout(
      sendMail({
        to: email,
        subject: 'Tempasi password reset',
        text: `Use this link to reset your password:\n\n${link}\n\nThis link expires in ${Math.floor(
          RESET_TOKEN_TTL_SECONDS / 60,
        )} minutes.\n\nIf you didn't request this, ignore this email.`,
      }),
      OP_TIMEOUT_MS,
      'mail:send',
    );

    if (wantsHtml(req)) {
      return res.status(200).render('pages/forgot-password', {
        ok: true,
        note: 'If that email exists, we sent a reset link.',
        email,
        _ms: Date.now() - startedAt,
      });
    }

    return res.status(200).json({ ok: true, _ms: Date.now() - startedAt });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      if (wantsHtml(req)) {
        return res.status(200).render('pages/forgot-password', {
          ok: true,
          note: 'If that email exists, we sent a reset link.',
        });
      }
      return res.status(200).json({ ok: true });
    }
    return next(err);
  }
});

// POST /reset-password  (token + newPassword)
router.post('/reset-password', parseBody, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.password || '');
    const tokenHash = sha256Hex(token);

    if (!token || newPassword.length < 8 || newPassword.length > 200) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ok: false,
          token,
          errors: ['Invalid token or password.'],
        });
      }
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST' } });
    }

    // bcrypt preferred (same style as auth.routes)
    let bcrypt;
    try {
      bcrypt = require('bcrypt');
    } catch (_) {
      bcrypt = require('bcryptjs');
    }
    const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

    const pool = getPool();

    // 1) resolve active token row + user_id
    const qFind = pool.query(
      `
      SELECT id, user_id, expires_at, used_at
      FROM password_resets
      WHERE token_hash = $1
        AND used_at IS NULL
      LIMIT 1
      `,
      [tokenHash],
    );

    const found = await withTimeout(qFind, OP_TIMEOUT_MS, 'db:reset find token');
    const row = found?.rows?.[0];

    if (!row) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ok: false,
          token,
          errors: ['Reset link is invalid or expired.'],
        });
      }
      return res.status(400).json({ ok: false, error: { code: 'TOKEN_INVALID' } });
    }

    // 2) expiry check
    const qExpire = pool.query(`SELECT ($1::timestamptz > NOW()) AS ok`, [row.expires_at]);
    const expRes = await withTimeout(qExpire, OP_TIMEOUT_MS, 'db:reset expiry check');
    const notExpired = Boolean(expRes?.rows?.[0]?.ok);

    if (!notExpired) {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ok: false,
          token,
          errors: ['Reset link is invalid or expired.'],
        });
      }
      return res.status(400).json({ ok: false, error: { code: 'TOKEN_EXPIRED' } });
    }

    // 3) hash new password
    const passwordHash = await withTimeout(
      bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      OP_TIMEOUT_MS,
      'bcrypt:hash',
    );

    // 4) transaction: update user password + mark token used + revoke sessions (logout-all)
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

      // revoke all sessions after password reset
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
        ok: true,
        token: '',
        note: 'Password updated. Please sign in.',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err && err.code === 'AUTH_TIMEOUT') {
      if (wantsHtml(req)) {
        return res.status(400).render('pages/reset-password', {
          ok: false,
          errors: ['Reset failed. Try again.'],
        });
      }
      return res.status(500).json({ ok: false, error: { code: 'TIMEOUT' } });
    }
    return next(err);
  }
});

module.exports = { passwordResetRouter: router };
