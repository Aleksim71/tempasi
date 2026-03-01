// src/server/catalog/templates.repo.js

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

function buildPreviewUrlById(id, updatedAt) {
  // Public previews are stored locally in: public/uploads/previews/<id>.png
  // Serve via: /uploads/previews/<id>.png
  // Add cache-buster to avoid stale image in browser.
  const v = updatedAt ? Date.parse(updatedAt) : Date.now();
  return `/uploads/previews/${id}.png?t=${Number.isFinite(v) ? v : Date.now()}`;
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
      created_at,
      updated_at
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

    const id = r.id; // IMPORTANT: keep numeric DB id for previews
    const slug = toStr(r.slug || '').trim();

    return {
      // ✅ real DB id
      id,

      slug,
      title: toStr(r.title || '').trim() || slug,
      name: toStr(r.title || '').trim() || slug,

      description: toStr(r.short_description || ''),

      // ✅ preview by numeric id
      previewUrl: buildPreviewUrlById(id, r.updated_at || r.created_at),

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
      created_at,
      updated_at
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

  const id = r.id;
  const slugStr = toStr(r.slug || '').trim();

  return {
    id, // ✅ real DB id
    slug: slugStr,
    title: toStr(r.title || '').trim() || slugStr,
    name: toStr(r.title || '').trim() || slugStr,

    description: toStr(r.short_description || ''),

    // ✅ preview by numeric id
    previewUrl: buildPreviewUrlById(id, r.updated_at || r.created_at),

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
