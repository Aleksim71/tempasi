'use strict';

/**
 * Tempasi Downloads (B12/B13.1)
 * Strict download: requires entitlement for (user_id, template_slug).
 *
 * B13.1: no DEV header/query bypass.
 * Auth must attach req.user (via cookie sessions middleware).
 */

function toStr(v) {
  return v === null || v === undefined ? '' : String(v);
}

function toInt(v) {
  const n = Number(toStr(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function pickUserId(req) {
  // Expect auth middleware to attach req.user
  const u = req.user;
  if (u && typeof u === 'object') {
    if (Number.isFinite(toInt(u.id))) return toInt(u.id);
    if (Number.isFinite(toInt(u.userId))) return toInt(u.userId);
  }
  if (Number.isFinite(toInt(req.userId))) return toInt(req.userId);

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
  if (!Number.isFinite(userId) || userId <= 0) {
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
