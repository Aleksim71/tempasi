'use strict';

// src/modules/auth/auth.routes.cjs

const express = require('express');
const bcrypt = require('bcrypt');
const {
  newSessionId,
  setSessionCookie,
  clearSessionCookie,
} = require('../../middlewares/auth.middleware.cjs');

function wantsHtml(req) {
  const accept = String(req.headers?.accept || '');
  if (accept.includes('text/html')) return true;
  if (accept.includes('application/xhtml+xml')) return true;

  // Most browser form posts include */* as well; treat non-json as html
  if (!accept) return true;
  if (accept.includes('application/json') || accept.includes('+json')) return false;
  return true;
}

function authRouter() {
  const router = express.Router();
  router.use(express.json());

  // ----------------------------
  // REGISTER (API)
  // ----------------------------
  router.post('/register', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ ok: false, error: 'EMAIL_PASSWORD_REQUIRED' });
      }

      const db = req.db;

      const hash = await bcrypt.hash(password, 10);

      const { rows } = await db.query(
        `
        INSERT INTO users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id
        `,
        [email, hash],
      );

      return res.status(201).json({ ok: true, userId: rows[0].id });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ ok: false, error: 'EMAIL_EXISTS' });
      }
      return res.status(500).json({ ok: false, error: 'REGISTER_FAILED' });
    }
  });

  // ----------------------------
  // LOGIN (API)
  // ----------------------------
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ ok: false, error: 'EMAIL_PASSWORD_REQUIRED' });
      }

      const db = req.db;

      const { rows } = await db.query(
        `
        SELECT id, password_hash
        FROM users
        WHERE email = $1
        LIMIT 1
        `,
        [email],
      );

      const user = rows[0];
      if (!user) {
        return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
      }

      const sid = newSessionId();

      await db.query(
        `
        INSERT INTO sessions (id, user_id, expires_at)
        VALUES ($1, $2, NOW() + interval '30 days')
        `,
        [sid, user.id],
      );

      setSessionCookie(req, res, sid, {
        maxAgeSeconds: 60 * 60 * 24 * 30,
      });

      return res.status(200).json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ ok: false, error: 'LOGIN_FAILED' });
    }
  });

  // ----------------------------
  // LOGOUT (API + HTML form)
  // ----------------------------
  router.post('/logout', async (req, res) => {
    try {
      const db = req.db;
      const sid = req.headers.cookie?.match(/sid=([^;]+)/)?.[1];

      if (sid) {
        await db.query(`DELETE FROM sessions WHERE id = $1`, [sid]);
      }

      clearSessionCookie(req, res);

      // ✅ HTML form submission -> redirect to templates
      if (wantsHtml(req)) {
        return res.redirect(302, '/templates');
      }

      // ✅ API/fetch -> JSON
      return res.status(200).json({ ok: true });
    } catch {
      // Be safe: still clear cookie, then respond/redirect
      try {
        clearSessionCookie(req, res);
      } catch {}

      if (wantsHtml(req)) {
        return res.redirect(302, '/templates');
      }

      return res.status(200).json({ ok: true });
    }
  });

  return router;
}

module.exports = { authRouter };
