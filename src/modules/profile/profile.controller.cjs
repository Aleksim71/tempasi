// src/modules/profile/profile.controller.cjs
'use strict';

const bcrypt = require('bcryptjs');
const path = require('path');
const EntitlementsService = require('../payments/entitlements.service.cjs');

function mustGetDb(req) {
  const locals = req && req.app && req.app.locals ? req.app.locals : {};

  const db =
    (req && req.db) ||
    (req && req.pool) ||
    locals.db ||
    locals.pool ||
    locals.pgPool ||
    locals.dbPool;

  if (!db || typeof db.query !== 'function') {
    const err = new Error('[profile] DB is not attached (expected req.db, req.pool, app.locals.db or app.locals.pool)');
    err.status = 500;
    err.code = 'DB_NOT_READY';
    throw err;
  }

  return db;
}

function getCurrentUserId(req) {
  const candidates = [
    req && req.user && req.user.id,
    req && req.userId,
    req && req.session && req.session.user && req.session.user.id,
    req && req.session && req.session.userId,
    req && req.session && req.session.auth && req.session.auth.user && req.session.auth.user.id,
    req && req.auth && req.auth.userId,
  ];

  const userId = candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== '');

  if (!userId) {
    const err = new Error('[profile] Authenticated user id is missing');
    err.status = 401;
    err.code = 'PROFILE_USER_ID_MISSING';
    throw err;
  }

  return userId;
}

function normalizeProfilePayload(body) {
  const src = body && typeof body === 'object' ? body : {};
  const out = {};

  if (Object.prototype.hasOwnProperty.call(src, 'full_name')) {
    out.full_name = src.full_name == null ? null : String(src.full_name).trim();
  }

  if (Object.prototype.hasOwnProperty.call(src, 'nickname')) {
    // TEMPASI_NICKNAME_PRESERVE_CASE (2026-07-26): used to force
    // .toLowerCase() here, which silently lowercased whatever the user
    // typed. Uniqueness is already enforced case-insensitively at the
    // DB level (user_profiles_nickname_unique_idx on lower(nickname)),
    // so dropping the app-level lowercase just lets the display keep
    // the casing the user actually entered.
    out.nickname = src.nickname == null ? null : String(src.nickname).trim();
  }

  if (Object.prototype.hasOwnProperty.call(src, 'about')) {
    out.about = src.about == null ? null : String(src.about).trim();
  }

  if (Object.prototype.hasOwnProperty.call(src, 'public_email')) {
    const value = src.public_email == null ? '' : String(src.public_email).trim();
    out.public_email = value || null;
  }

  if (Object.prototype.hasOwnProperty.call(src, 'public_profile')) {
    out.public_profile = Boolean(src.public_profile);
  }

  return out;
}

function validateProfilePayload(payload) {
  const errors = [];

  if (!payload.full_name) {
    errors.push('full_name is required');
  } else if (payload.full_name.length > 120) {
    errors.push('full_name must be at most 120 characters');
  }

  if (!payload.nickname) {
    errors.push('nickname is required');
  } else {
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

  if (!payload.about) {
    errors.push('about is required');
  } else if (payload.about.length > 300) {
    errors.push('about must be at most 300 characters');
  }

  if (payload.public_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.public_email)) {
    errors.push('public_email must be a valid email address');
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
        public_email,
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
  const userId = getCurrentUserId(req);
  const db = mustGetDb(req);

  const row = await getProfileRow(db, userId);

  return res.json({
    profile: {
      full_name: row ? row.full_name : null,
      nickname: row ? row.nickname : null,
      about: row ? row.about : null,
      public_email: row ? row.public_email : null,
      public_profile: row ? row.public_profile : false,
    },
  });
}

async function updateMyProfileJson(req, res) {
  const userId = getCurrentUserId(req);
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

  const publicEmail =
    Object.prototype.hasOwnProperty.call(payload, 'public_email')
      ? payload.public_email
      : existing?.public_email ?? null;

  const publicProfile =
    Object.prototype.hasOwnProperty.call(payload, 'public_profile')
      ? payload.public_profile
      : existing?.public_profile ?? false;

  const { rows } = await db.query(
    `
      INSERT INTO user_profiles (
        user_id,
        full_name,
        nickname,
        about,
        public_email,
        public_profile
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        nickname = EXCLUDED.nickname,
        about = EXCLUDED.about,
        public_email = EXCLUDED.public_email,
        public_profile = EXCLUDED.public_profile,
        updated_at = now()
      RETURNING
        user_id,
        full_name,
        nickname,
        about,
        public_email,
        public_profile,
        updated_at
    `,
    [userId, fullName, nickname, about, publicEmail, publicProfile],
  );

  return res.json({
    ok: true,
    profile: {
      full_name: rows[0].full_name,
      nickname: rows[0].nickname,
      about: rows[0].about,
      public_email: rows[0].public_email,
      public_profile: rows[0].public_profile,
    },
    updated_at: rows[0].updated_at,
  });
}

async function changeMyPasswordJson(req, res) {
  const userId = getCurrentUserId(req);
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

// TEMPASI_PROFILE_AVATAR_UPLOAD (2026-08-04)
// Called after multer (see profile.api.routes.cjs) has already saved
// the file to AVATAR_UPLOAD_DIR/<userId>/avatar.<ext>. This just
// records the resulting URL in user_profiles.avatar_url. Serving is
// handled by a dedicated route in app.web.js (same pattern as the
// template preview route), not express.static.
async function uploadMyAvatarJson(req, res) {
  const userId = getCurrentUserId(req);
  const db = mustGetDb(req);

  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'AVATAR_FILE_REQUIRED' });
  }

  const ext = path.extname(req.file.filename).replace('.', '').toLowerCase();
  const avatarUrl = `/u/${userId}/avatar.${ext}?v=${Date.now()}`;

  await db.query(
    `
      INSERT INTO user_profiles (user_id, avatar_url)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET
        avatar_url = EXCLUDED.avatar_url,
        updated_at = now()
    `,
    [userId, avatarUrl],
  );

  return res.json({ ok: true, avatar_url: avatarUrl });
}

async function getMyDownloadsJson(req, res) {
  const userId = getCurrentUserId(req);
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
  uploadMyAvatarJson,
};
