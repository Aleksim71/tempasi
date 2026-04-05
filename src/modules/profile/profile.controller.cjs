// src/modules/profile/profile.controller.cjs
'use strict';

const bcrypt = require('bcryptjs');
const EntitlementsService = require('../payments/entitlements.service.cjs');

function mustGetDb(req) {
  const db =
    (req && req.db) ||
    (req && req.app && req.app.locals && req.app.locals.db);

  if (!db || typeof db.query !== 'function') {
    const err = new Error('[profile] DB is not attached (expected req.db or app.locals.db)');
    err.status = 500;
    err.code = 'DB_NOT_READY';
    throw err;
  }

  return db;
}

function normalizeProfilePayload(body) {
  const src = body && typeof body === 'object' ? body : {};
  const out = {};

  if (Object.prototype.hasOwnProperty.call(src, 'full_name')) {
    out.full_name = src.full_name == null ? null : String(src.full_name).trim();
  }

  if (Object.prototype.hasOwnProperty.call(src, 'nickname')) {
    out.nickname = src.nickname == null ? null : String(src.nickname).trim().toLowerCase();
  }

  if (Object.prototype.hasOwnProperty.call(src, 'about')) {
    out.about = src.about == null ? null : String(src.about).trim();
  }

  return out;
}

function validateProfilePayload(payload) {
  const errors = [];

  if ('full_name' in payload && payload.full_name && payload.full_name.length > 120) {
    errors.push('full_name must be at most 120 characters');
  }

  if ('nickname' in payload && payload.nickname) {
    if (payload.nickname.length < 2) {
      errors.push('nickname must be at least 2 characters');
    }
    if (payload.nickname.length > 50) {
      errors.push('nickname must be at most 50 characters');
    }
    if (!/^[a-z0-9._-]+$/i.test(payload.nickname)) {
      errors.push('nickname may contain only letters, digits, dot, underscore, hyphen');
    }
  }

  if ('about' in payload && payload.about && payload.about.length > 300) {
    errors.push('about must be at most 300 characters');
  }

  return errors;
}

async function getProfileRow(db, userId) {
  const { rows } = await db.query(
    `
      SELECT
        user_id,
        full_name,
        nickname,
        about,
        avatar_url,
        role_title,
        location,
        website_url,
        public_profile,
        created_at,
        updated_at
      FROM user_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
}

async function getMyProfileJson(req, res) {
  const userId = req.user.id;
  const db = mustGetDb(req);

  const row = await getProfileRow(db, userId);

  return res.json({
    profile: {
      full_name: row ? row.full_name : null,
      nickname: row ? row.nickname : null,
      about: row ? row.about : null,
    },
  });
}

async function updateMyProfileJson(req, res) {
  const userId = req.user.id;
  const db = mustGetDb(req);

  const payload = normalizeProfilePayload(req.body);
  const errors = validateProfilePayload(payload);

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'PROFILE_VALIDATION_FAILED',
      details: errors,
    });
  }

  const existing = await getProfileRow(db, userId);

  const fullName =
    Object.prototype.hasOwnProperty.call(payload, 'full_name')
      ? payload.full_name
      : existing?.full_name ?? null;

  const nickname =
    Object.prototype.hasOwnProperty.call(payload, 'nickname')
      ? payload.nickname
      : existing?.nickname ?? null;

  const about =
    Object.prototype.hasOwnProperty.call(payload, 'about')
      ? payload.about
      : existing?.about ?? null;

  const { rows } = await db.query(
    `
      INSERT INTO user_profiles (
        user_id,
        full_name,
        nickname,
        about
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        nickname = EXCLUDED.nickname,
        about = EXCLUDED.about,
        updated_at = now()
      RETURNING
        user_id,
        full_name,
        nickname,
        about,
        updated_at
    `,
    [userId, fullName, nickname, about],
  );

  return res.json({
    ok: true,
    profile: {
      full_name: rows[0].full_name,
      nickname: rows[0].nickname,
      about: rows[0].about,
    },
    updated_at: rows[0].updated_at,
  });
}

async function changeMyPasswordJson(req, res) {
  const userId = req.user.id;
  const db = mustGetDb(req);

  const currentPassword = String(req.body?.current_password || '');
  const newPassword = String(req.body?.new_password || '');
  const repeatPassword = String(req.body?.repeat_password || '');

  if (!currentPassword || !newPassword || !repeatPassword) {
    return res.status(400).json({
      ok: false,
      error: 'PASSWORD_FIELDS_REQUIRED',
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      ok: false,
      error: 'PASSWORD_TOO_SHORT',
    });
  }

  if (newPassword !== repeatPassword) {
    return res.status(400).json({
      ok: false,
      error: 'PASSWORD_REPEAT_MISMATCH',
    });
  }

  const userResult = await db.query(
    `
      SELECT id, password_hash
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );

  const user = userResult.rows[0] || null;

  if (!user || !user.password_hash) {
    return res.status(404).json({
      ok: false,
      error: 'USER_NOT_FOUND',
    });
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, user.password_hash);

  if (!isCurrentValid) {
    return res.status(400).json({
      ok: false,
      error: 'CURRENT_PASSWORD_INVALID',
    });
  }

  const nextHash = await bcrypt.hash(newPassword, 12);

  await db.query(
    `
      UPDATE users
      SET password_hash = $2,
          updated_at = now()
      WHERE id = $1
    `,
    [userId, nextHash],
  );

  return res.json({
    ok: true,
  });
}

async function getMyDownloadsJson(req, res) {
  const userId = req.user.id;
  const db = mustGetDb(req);

  const rows = await EntitlementsService.listUserEntitlements({ db, userId });

  const items = (rows || [])
    .map((r) => ({
      template_slug: r.template_slug,
      deal_type: r.kind === 'rent' ? 'RENT' : 'BUY',
      created_at: r.created_at,
    }))
    .filter((x) => x.deal_type === 'BUY');

  return res.json({ items });
}

module.exports = {
  changeMyPasswordJson,
  getMyDownloadsJson,
  getMyProfileJson,
  updateMyProfileJson,
};
