/* eslint-env node */
'use strict';

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name}_REQUIRED`);
}

function normalizeSlug(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')        // spaces/underscores -> dash
    .replace(/[^a-z0-9-]/g, '')     // drop unsafe
    .replace(/-+/g, '-')            // collapse dashes
    .replace(/^-|-$/g, '');         // trim dashes
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

async function insertSellerTemplate({
  pool,
  ownerUserId,
  title,
  slug,
  shortDescription,
  priceBuy,
  priceRent,
  status,
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
      (owner_user_id, title, slug, short_description, price_buy_cents, price_rent_cents, status)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, owner_user_id, title, slug, short_description, price_buy_cents, price_rent_cents, status, created_at
  `;

  const params = [
    ownerUserId,
    title.trim(),
    normSlug,
    shortDescription ? String(shortDescription).trim() : null,
    price_buy_cents,
    price_rent_cents,
    finalStatus,
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

module.exports = {
  insertSellerTemplate,
  normalizeSlug,
  toCentsOrNull,
};
