// src/server/catalog/templates.repo.js
import path from 'node:path';

function toStr(v) {
  return v == null ? '' : String(v);
}

function centsToMoney(amountCents) {
  if (amountCents === null || amountCents === undefined) return null;
  const n = Number(amountCents);
  if (!Number.isFinite(n)) return null;
  return Number((n / 100).toFixed(2));
}

function normalizeDealType(row) {
  const buy = row?.price_buy_cents !== null && row?.price_buy_cents !== undefined;
  const rent = row?.price_rent_cents !== null && row?.price_rent_cents !== undefined;

  if (buy && rent) return 'sale+rent';
  if (buy) return 'sale';
  if (rent) return 'rent';
  return '';
}

function buildPreviewUrl(slug) {
  // Keep existing public preview convention: /t/<slug>/preview.png
  // Later we can generate and store preview path in DB.
  return `/t/${slug}/preview.png`;
}

function requireDb(db) {
  // Routes pass req.app.locals.db
  // We expect pg Pool-like object with .query(sql, params)
  if (!db || typeof db.query !== 'function') {
    throw new Error(
      'DB_NOT_CONFIGURED: req.app.locals.db must be a pg Pool-like object with .query()',
    );
  }
  return db;
}

/**
 * Public catalog (DB-backed).
 * Rule: show ONLY published + not deleted.
 */
export async function selectTemplatesForCatalog(db) {
  const pool = requireDb(db);

  const q = `
    SELECT
      id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path,
      created_at
    FROM seller_templates
    WHERE status = 'published'
      AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `;

  const { rows } = await pool.query(q, []);
  return (rows || []).map((r) => {
    const buyAmount = centsToMoney(r.price_buy_cents);
    const rentAmount = centsToMoney(r.price_rent_cents);

    return {
      // routes normalizeTemplate understands slug/id/title/name/meta/prices/zipReady/hasZip
      id: toStr(r.slug || r.id),
      slug: toStr(r.slug || ''),
      title: toStr(r.title || '').trim() || toStr(r.slug || ''),
      name: toStr(r.title || '').trim() || toStr(r.slug || ''),

      description: toStr(r.short_description || ''),
      previewUrl: buildPreviewUrl(r.slug),

      // “zipReady/hasZip” flags
      zipReady: Boolean(r.zip_path),
      hasZip: Boolean(r.zip_path),

      // for existing UI filters/labels (optional)
      dealType: normalizeDealType(r),

      // Contract-like prices object supported by templates.routes.js normalizeTemplate()
      prices: {
        buy: buyAmount !== null ? { amount: buyAmount, currency: 'EUR' } : null,
        rent: rentAmount !== null ? { amount: rentAmount, currency: 'EUR', period: 'mo' } : null,
      },

      // keep legacy fields some pages may still use
      price: buyAmount !== null ? buyAmount : '',
      currency: 'EUR',
    };
  });
}

/**
 * Public details by slug (DB-backed).
 * Rule: draft MUST be invisible (404), only published + not deleted.
 */
export async function getTemplateBySlug(db, slug) {
  const pool = requireDb(db);
  const s = toStr(slug).trim();
  if (!s) return null;

  const q = `
    SELECT
      id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path,
      created_at
    FROM seller_templates
    WHERE slug = $1
      AND status = 'published'
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const { rows } = await pool.query(q, [s]);
  const r = rows && rows[0] ? rows[0] : null;
  if (!r) return null;

  const buyAmount = centsToMoney(r.price_buy_cents);
  const rentAmount = centsToMoney(r.price_rent_cents);

  return {
    id: toStr(r.slug || r.id),
    slug: toStr(r.slug || ''),
    title: toStr(r.title || '').trim() || toStr(r.slug || ''),
    name: toStr(r.title || '').trim() || toStr(r.slug || ''),

    description: toStr(r.short_description || ''),
    previewUrl: buildPreviewUrl(r.slug),
    demoUrl: '',

    zipReady: Boolean(r.zip_path),
    hasZip: Boolean(r.zip_path),

    dealType: normalizeDealType(r),

    prices: {
      buy: buyAmount !== null ? { amount: buyAmount, currency: 'EUR' } : null,
      rent: rentAmount !== null ? { amount: rentAmount, currency: 'EUR', period: 'mo' } : null,
    },

    price: buyAmount !== null ? buyAmount : '',
    currency: 'EUR',
  };
}

export default {
  selectTemplatesForCatalog,
  getTemplateBySlug,
};
