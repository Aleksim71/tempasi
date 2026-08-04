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
  category = 'other',
  tags = '',
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
        category,
        tags,
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
        $8,
        $9,
        $10,
        $11,
        NOW()
      )
    RETURNING
      id,
      owner_user_id,
      title,
      slug,
      short_description,
      category,
      tags,
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
    category ? String(category).trim() : 'other',
    tags ? String(tags).trim() : '',
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
      const err = new Error('SLUG_ALREADY_EXISTS');
      err.code = 'SLUG_ALREADY_EXISTS';
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
      st.id,
      st.owner_user_id,
      st.title,
      st.slug,
      st.short_description,
      st.price_buy_cents,
      st.price_rent_cents,
      st.status,
      st.zip_path,
      st.zip_original_name,
      st.zip_uploaded_at,
      st.admin_blocked_at,
      st.deleted_at,
      st.created_at,
      st.updated_at,
      MAX(o.created_at) FILTER (WHERE o.status = 'paid' AND o.deal_type = 'BUY') AS sold_at,
      COUNT(*) FILTER (WHERE o.status = 'paid' AND o.deal_type = 'BUY')::int AS sold_count
    FROM seller_templates st
    LEFT JOIN orders o
      ON o.template_slug = st.slug
    WHERE st.owner_user_id = $1
      AND st.deleted_at IS NULL
    GROUP BY
      st.id,
      st.owner_user_id,
      st.title,
      st.slug,
      st.short_description,
      st.price_buy_cents,
      st.price_rent_cents,
      st.status,
      st.zip_path,
      st.zip_original_name,
      st.zip_uploaded_at,
      st.admin_blocked_at,
      st.deleted_at,
      st.created_at,
      st.updated_at
    ORDER BY st.created_at DESC
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
      admin_blocked_at,
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
  category = 'other',
  tags = '',
  priceBuy,
  priceRent,
  status,
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

  const st = status && String(status).trim() ? String(status).trim() : 'draft';
  const allowedStatuses = new Set(['draft', 'published']);
  const finalStatus = allowedStatuses.has(st) ? st : 'draft';

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
        category = $4,
        tags = $5,
        price_buy_cents = $6,
        price_rent_cents = $7,
        status = $8,
        zip_path = $9::text,
        zip_original_name = $10::text,
        zip_uploaded_at = CASE WHEN $9::text IS NULL THEN NULL ELSE NOW() END,
        updated_at = NOW()
      WHERE id = $11
        AND owner_user_id = $12
        AND deleted_at IS NULL
        AND ($8 <> 'published' OR admin_blocked_at IS NULL)
      RETURNING
        id,
        owner_user_id,
        title,
        slug,
        short_description,
        category,
        tags,
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
        category = $4,
        tags = $5,
        price_buy_cents = $6,
        price_rent_cents = $7,
        status = $8,
        updated_at = NOW()
      WHERE id = $9
        AND owner_user_id = $10
        AND deleted_at IS NULL
        AND ($8 <> 'published' OR admin_blocked_at IS NULL)
      RETURNING
        id,
        owner_user_id,
        title,
        slug,
        short_description,
        category,
        tags,
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
        category ? String(category).trim() : 'other',
        tags ? String(tags).trim() : '',
        price_buy_cents,
        price_rent_cents,
        finalStatus,
        zipPath === undefined ? null : zipPath,
        zipOriginalName === undefined ? null : zipOriginalName,
        id,
        ownerUserId,
      ]
    : [
        title.trim(),
        normSlug,
        shortDescription ? String(shortDescription).trim() : null,
        category ? String(category).trim() : 'other',
        tags ? String(tags).trim() : '',
        price_buy_cents,
        price_rent_cents,
        finalStatus,
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
      AND ($1 <> 'published' OR admin_blocked_at IS NULL)
    RETURNING id, status
  `;

  const { rows } = await pool.query(q, [status, id, ownerUserId]);
  return rows[0] || null;
}

// ------------------------------------------------------------
// ADMIN block/unblock (NOT owner-scoped — admin-only write path).
// Block forces status='draft'; unblock does NOT restore 'published'
// (seller must republish manually). See PILGRIM.md for the decision.
// ------------------------------------------------------------
async function adminSetBlocked({ pool, id, blocked }) {
  if (!pool) throw new Error('DB_POOL_REQUIRED');
  if (!id) throw new Error('ID_REQUIRED');

  const q = blocked
    ? `
      UPDATE seller_templates
      SET status = 'draft',
          admin_blocked_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id, slug, status, admin_blocked_at
    `
    : `
      UPDATE seller_templates
      SET admin_blocked_at = NULL,
          updated_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id, slug, status, admin_blocked_at
    `;

  const { rows } = await pool.query(q, [id]);
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

// ------------------------------------------------------------
// ADMIN soft delete (not owner-scoped — admin-only write path).
// Same soft-delete semantics as softDeleteByOwner (deleted_at = NOW()),
// no filesystem access — the ZIP/preview files stay on disk. This is
// step 1 of a two-step trash flow: soft-deleted items land in
// admin_list_trash below, where they can be restored or purged for
// real (admin_hard_delete).
// ------------------------------------------------------------
async function adminSoftDelete({ pool, id }) {
  if (!pool) throw new Error('DB_POOL_REQUIRED');
  if (!id) throw new Error('ID_REQUIRED');

  const q = `
    UPDATE seller_templates
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1
      AND deleted_at IS NULL
    RETURNING id, slug
  `;

  const { rows } = await pool.query(q, [id]);
  return rows[0] || null;
}

async function adminListTrash({ pool, limit, offset }) {
  const { rows } = await pool.query(
    `
    SELECT
      st.id, st.slug, st.title, st.deleted_at,
      COALESCE(NULLIF(TRIM(up.nickname), ''), NULLIF(TRIM(up.full_name), ''), u.email) AS owner_display
    FROM seller_templates st
    JOIN users u ON u.id = st.owner_user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE st.deleted_at IS NOT NULL
    ORDER BY st.deleted_at DESC, st.id DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );
  return rows;
}

async function adminCountTrash({ pool }) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM seller_templates WHERE deleted_at IS NOT NULL`,
  );
  return rows[0]?.n || 0;
}

async function adminRestore({ pool, id }) {
  const { rows } = await pool.query(
    `
    UPDATE seller_templates
    SET deleted_at = NULL, updated_at = NOW()
    WHERE id = $1
      AND deleted_at IS NOT NULL
    RETURNING id, slug
    `,
    [id],
  );
  return rows[0] || null;
}

// Hard delete — only allowed on rows already in trash (deleted_at IS
// NOT NULL). "Delete forever" is deliberately step 2 of the trash
// flow, not a shortcut around it. Returns zip_path/slug so the
// caller (service layer) can best-effort clean up files on disk.
async function adminHardDelete({ pool, id }) {
  const { rows } = await pool.query(
    `
    DELETE FROM seller_templates
    WHERE id = $1
      AND deleted_at IS NOT NULL
    RETURNING id, slug, zip_path
    `,
    [id],
  );
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

  // admin-only (not owner-scoped)
  adminSetBlocked,
  adminSoftDelete,
  adminListTrash,
  adminCountTrash,
  adminRestore,
  adminHardDelete,

  // utils
  normalizeSlug,
  toCentsOrNull,
};
