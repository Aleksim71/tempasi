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
      }`
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

function isDev() {
  return process.env.NODE_ENV !== 'production';
}

// DEV-only: create a real cookie session for a given user id.
// This replaces x-dev-user-id.
router.post('/dev-login', express.json(), async (req, res, next) => {
  try {
    if (!isDev()) return res.status(404).send('Not found');

    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'userId is required',
        },
      });
    }

    const sid = newSessionId();
    const maxAgeSeconds = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 30);

    const pool = getPool();
    await pool.query(
      `
      INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
      VALUES ($1, $2::bigint, NOW(), NOW(), NOW() + ($3 || ' seconds')::interval)
      `,
      [sid, userId, String(maxAgeSeconds)]
    );

    setSessionCookie(res, sid, { maxAgeSeconds });
    return res.status(200).json({ ok: true, userId });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const cookie = req.headers.cookie || '';
    const sidMatch = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
    const sid = sidMatch ? decodeURIComponent(sidMatch[1]) : '';

    if (sid) {
      const pool = getPool();
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [sid]);
    }

    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = {
  authRouter: router,
};
