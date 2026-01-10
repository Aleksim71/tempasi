'use strict';

/**
 * Tempasi Downloads (B12)
 * Strict download: requires entitlement for (user_id, template_slug).
 *
 * DEV convenience:
 * - If NODE_ENV=development and no auth user found,
 *   allow passing user id via:
 *     - header:  x-dev-user-id: <number>
 *     - query:   ?dev_user_id=<number>
 */

function toStr(v) {
  return v === null || v === undefined ? '' : String(v);
}

function toInt(v) {
  const n = Number(toStr(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function isDev() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'development';
}

function pickUserId(req) {
  // 1) normal auth (if your auth middleware attaches something)
  // try a few common shapes to avoid coupling
  const u = req.user;
  if (u && typeof u === 'object') {
    if (Number.isFinite(Number(u.id))) return Number(u.id);
    if (Number.isFinite(Number(u.userId))) return Number(u.userId);
  }
  if (Number.isFinite(Number(req.userId))) return Number(req.userId);

  // 2) DEV override
  if (isDev()) {
    const h = req.headers['x-dev-user-id'];
    const q = req.query && req.query.dev_user_id;
    const id = Number.isFinite(toInt(h)) ? toInt(h) : toInt(q);
    if (Number.isFinite(id) && id > 0) return id;
  }

  return NaN;
}

async function findZipForSlug(slug) {
  // Reuse existing ESM helper (used in app.js fallback).
  // We dynamic-import it from CJS.
  const mod = await import('../../server/downloads/findZipForSlug.js');
  const fn = mod && (mod.findZipForSlug || mod.default || mod);
  if (typeof fn !== 'function') {
    const err = new Error('FIND_ZIP_HELPER_MISSING');
    err.status = 500;
    throw err;
  }
  return fn(slug);
}

async function downloadZip(req, res) {
  const slug = toStr(req.params.slug).trim();
  if (!slug) {
    const err = new Error('SLUG_REQUIRED');
    err.status = 400;
    throw err;
  }

  const userId = pickUserId(req);
  if (!Number.isFinite(userId)) {
    const err = new Error('AUTH_REQUIRED');
    err.status = 401;
    throw err;
  }

  const { pool } = require('../../config/db.cjs');

  // Strict entitlement check:
  // allow if exists and not expired (ends_at null or future).
  const ent = await pool.query(
    `
    SELECT id, user_id, template_slug, kind, order_id, starts_at, ends_at
      FROM public.entitlements
     WHERE user_id = $1
       AND template_slug = $2
       AND (ends_at IS NULL OR ends_at > now())
     LIMIT 1
    `,
    [userId, slug]
  );

  if (!ent.rows[0]) {
    const err = new Error('ENTITLEMENT_REQUIRED');
    err.status = 403;
    throw err;
  }

  const hit = await findZipForSlug(slug);
  if (!hit) {
    const err = new Error('ARCHIVE_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  // res.download handles HEAD as well (Express will call the GET handler for HEAD).
  return res.download(hit.absPath, hit.fileName);
}

module.exports = { downloadZip };
