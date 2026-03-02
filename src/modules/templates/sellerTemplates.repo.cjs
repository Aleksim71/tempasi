/* eslint-env node */
'use strict';

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name}_REQUIRED`);
}

function normalizeSlug(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-') // spaces/underscores -> dash
    .replace(/[^a-z0-9-]/g, '') // drop unsafe
    .replace(/-+/g, '-') // collapse dashes
    .replace(/^-|-$/g, ''); // trim dashes
  return s;
}

function toCentsOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;

  const normalized = s.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;

  return Math.round(num * 100);
}

// ------------------------------------------------------------
// INSERT (with optional ZIP meta)
// ------------------------------------------------------------
async function insertSellerTemplate({
  pool,
  ownerUserId,
  title,
  slug,
  shortDescription,
  priceBuy,
  priceRent,
  status,
  zipPath = null,
  zipOriginalName = null,
}) {
  if (!pool) throw new Error('DB_POOL_REQUIRED');
  if (!ownerUserId) throw new Error('OWNER_USER_ID_REQUIRED');
  assertNonEmptyString(title, 'TITLE');

  const normSlug = normalizeSlug(slug);
  assertNonEmptyString(normSlug, 'SLUG');

  const st = status && String(status).trim() ? String(status).trim() : 'draft';
  const allowed = new Set(['draft', 'published']);
  const finalStatus = allowed.has(st) ? st : 'draft';

  const price_buy_cents = toCentsOrNull(priceBuy);
  const price_rent_cents = toCentsOrNull(priceRent);

  const q = `
    INSERT INTO seller_templates
      (
        owner_user_id,
        title,
        slug,
        short_description,
        price_buy_cents,
        price_rent_cents,
        status,
        zip_path,
        zip_original_name,
        zip_uploaded_at
      )
    VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::text,
        $9::text,
        CASE WHEN $8::text IS NULL THEN NULL ELSE NOW() END
      )
    RETURNING
      id,
      owner_user_id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path,
      zip_original_name,
      zip_uploaded_at,
      deleted_at,
      created_at,
      updated_at
  `;

  const params = [
    ownerUserId,
    title.trim(),
    normSlug,
    shortDescription ? String(shortDescription).trim() : null,
    price_buy_cents,
    price_rent_cents,
    finalStatus,
    zipPath === undefined ? null : zipPath,
    zipOriginalName === undefined ? null : zipOriginalName,
  ];

  try {
    const { rows } = await pool.query(q, params);
    return rows[0];
  } catch (e) {
    if (e && e.code === '23505') {
      const err = new Error('SLUG_TAKEN');
      err.code = 'SLUG_TAKEN';
      throw err;
    }
    throw e;
  }
}

// ------------------------------------------------------------
// LIST (Owner-safe) — canonical name: listByOwner
// ------------------------------------------------------------
async function listByOwner({ pool, ownerUserId }) {
  if (!pool) throw new Error('DB_POOL_REQUIRED');
  if (!ownerUserId) throw new Error('OWNER_USER_ID_REQUIRED');

  const q = `
    SELECT
      id,
      owner_user_id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path,
      zip_original_name,
      zip_uploaded_at,
      deleted_at,
      created_at,
      updated_at
    FROM seller_templates
    WHERE owner_user_id = $1
      AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;

  const { rows } = await pool.query(q, [ownerUserId]);
  return rows;
}

// backward-compat alias
async function listSellerTemplatesForOwner({ pool, ownerUserId }) {
  return listByOwner({ pool, ownerUserId });
}

// ------------------------------------------------------------
// GET ONE (Owner-safe)
// ------------------------------------------------------------
async function getSellerTemplateForOwnerById({ pool, ownerUserId, id }) {
  if (!pool) throw new Error('DB_POOL_REQUIRED');
  if (!ownerUserId) throw new Error('OWNER_USER_ID_REQUIRED');
  if (!id) throw new Error('TEMPLATE_ID_REQUIRED');

  const q = `
    SELECT
      id,
      owner_user_id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path,
      zip_original_name,
      zip_uploaded_at,
      deleted_at,
      created_at,
      updated_at
    FROM seller_templates
    WHERE owner_user_id = $1
      AND id = $2
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const { rows } = await pool.query(q, [ownerUserId, id]);
  return rows[0] || null;
}

// ------------------------------------------------------------
// UPDATE fields (+ optional ZIP) (Owner-safe)
// ------------------------------------------------------------
async function updateSellerTemplateByOwner({
  pool,
  ownerUserId,
  id,
  title,
  slug,
  shortDescription,
  priceBuy,
  priceRent,
  zipPath, // optional
  zipOriginalName, // optional
}) {
  if (!pool) throw new Error('DB_POOL_REQUIRED');
  if (!ownerUserId) throw new Error('OWNER_USER_ID_REQUIRED');
  if (!id) throw new Error('ID_REQUIRED');

  assertNonEmptyString(title, 'TITLE');

  const normSlug = normalizeSlug(slug);
  assertNonEmptyString(normSlug, 'SLUG');

  const price_buy_cents = toCentsOrNull(priceBuy);
  const price_rent_cents = toCentsOrNull(priceRent);

  // If zipPath is provided (even null), update zip meta.
  // If zipPath is undefined => do not touch ZIP columns.
  const withZip = zipPath !== undefined;

  const q = withZip
    ? `
      UPDATE seller_templates
      SET
        title = $1,
        slug = $2,
        short_description = $3,
        price_buy_cents = $4,
        price_rent_cents = $5,
        zip_path = $6::text,
        zip_original_name = $7::text,
        zip_uploaded_at = CASE WHEN $6::text IS NULL THEN NULL ELSE NOW() END,
        updated_at = NOW()
      WHERE id = $8
        AND owner_user_id = $9
        AND deleted_at IS NULL
      RETURNING
        id,
        owner_user_id,
        title,
        slug,
        short_description,
        price_buy_cents,
        price_rent_cents,
        status,
        zip_path,
        zip_original_name,
        zip_uploaded_at,
        updated_at
    `
    : `
      UPDATE seller_templates
      SET
        title = $1,
        slug = $2,
        short_description = $3,
        price_buy_cents = $4,
        price_rent_cents = $5,
        updated_at = NOW()
      WHERE id = $6
        AND owner_user_id = $7
        AND deleted_at IS NULL
      RETURNING
        id,
        owner_user_id,
        title,
        slug,
        short_description,
        price_buy_cents,
        price_rent_cents,
        status,
        zip_path,
        zip_original_name,
        zip_uploaded_at,
        updated_at
    `;

  const params = withZip
    ? [
        title.trim(),
        normSlug,
        shortDescription ? String(shortDescription).trim() : null,
        price_buy_cents,
        price_rent_cents,
        zipPath === undefined ? null : zipPath,
        zipOriginalName === undefined ? null : zipOriginalName,
        id,
        ownerUserId,
      ]
    : [
        title.trim(),
        normSlug,
        shortDescription ? String(shortDescription).trim() : null,
        price_buy_cents,
        price_rent_cents,
        id,
        ownerUserId,
      ];

  try {
    const { rows } = await pool.query(q, params);
    return rows[0] || null;
  } catch (e) {
    if (e && e.code === '23505') {
      const err = new Error('SLUG_TAKEN');
      err.code = 'SLUG_TAKEN';
      throw err;
    }
    throw e;
  }
}

// ------------------------------------------------------------
// STATUS update (Owner-safe)
// ------------------------------------------------------------
async function updateStatusByOwner({ pool, ownerUserId, id, status }) {
  if (!pool) throw new Error('DB_POOL_REQUIRED');
  if (!ownerUserId) throw new Error('OWNER_USER_ID_REQUIRED');
  if (!id) throw new Error('ID_REQUIRED');

  const allowed = new Set(['draft', 'published']);
  if (!allowed.has(status)) throw new Error('INVALID_STATUS');

  const q = `
    UPDATE seller_templates
    SET status = $1, updated_at = NOW()
    WHERE id = $2
      AND owner_user_id = $3
      AND deleted_at IS NULL
    RETURNING id, status
  `;

  const { rows } = await pool.query(q, [status, id, ownerUserId]);
  return rows[0] || null;
}

// ------------------------------------------------------------
// SOFT DELETE (Owner-safe)
// ------------------------------------------------------------
async function softDeleteByOwner({ pool, ownerUserId, id }) {
  if (!pool) throw new Error('DB_POOL_REQUIRED');
  if (!ownerUserId) throw new Error('OWNER_USER_ID_REQUIRED');
  if (!id) throw new Error('ID_REQUIRED');

  const q = `
    UPDATE seller_templates
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1
      AND owner_user_id = $2
      AND deleted_at IS NULL
    RETURNING id
  `;

  const { rows } = await pool.query(q, [id, ownerUserId]);
  return rows[0] || null;
}

module.exports = {
  insertSellerTemplate,

  // list
  listByOwner,
  listSellerTemplatesForOwner,

  // get/update
  getSellerTemplateForOwnerById,
  updateSellerTemplateByOwner,
  updateStatusByOwner,
  softDeleteByOwner,

  // utils
  normalizeSlug,
  toCentsOrNull,
};
