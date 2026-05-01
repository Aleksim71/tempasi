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
  if (!db || typeof db.query !== 'function') {
    throw new Error(
      'DB_NOT_CONFIGURED: req.app.locals.db must be a pg Pool-like object with .query()',
    );
  }
  return db;
}

function buildPreviewUrlBySlug(slug) {
  // ✅ canonical public endpoint
  // It will serve cached preview or lazily generate it from ZIP.
  return `/t/${encodeURIComponent(slug)}/preview.png`;
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
      owner_user_id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path,
      created_at,
      updated_at,
      EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.template_slug = seller_templates.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      ) AS is_sold,
      (
        SELECT MAX(o.created_at)
        FROM orders o
        WHERE o.template_slug = seller_templates.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      ) AS sold_at
    FROM seller_templates
    WHERE status = 'published'
      AND deleted_at IS NULL
      -- Hide templates already bought exclusively.
      AND NOT EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.template_slug = seller_templates.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      )
      -- Hide templates currently reserved by active RENT.
      AND NOT EXISTS (
        SELECT 1
        FROM public.entitlements e
        WHERE e.template_slug = seller_templates.slug
          AND UPPER(COALESCE(e.deal_type, e.kind, '')) = 'RENT'
          AND e.closed_at IS NULL
          AND (e.ends_at IS NULL OR e.ends_at > now())
          AND (e.ends_at IS NULL OR e.ends_at > NOW())
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `;

  const { rows } = await pool.query(q, []);
  return (rows || []).map((r) => {
    const buyAmount = centsToMoney(r.price_buy_cents);
    const rentAmount = centsToMoney(r.price_rent_cents);

    const id = r.id;
    const slug = toStr(r.slug || '').trim();

    return {
      // keep real DB id (useful for other logic)
      id,
      ownerUserId: r.owner_user_id || null,

      slug,
      title: toStr(r.title || '').trim() || slug,
      name: toStr(r.title || '').trim() || slug,

      description: toStr(r.short_description || ''),

      // ✅ ALWAYS go through /t/<slug>/preview.png
      previewUrl: buildPreviewUrlBySlug(slug),

      zipReady: Boolean(r.zip_path),
      hasZip: Boolean(r.zip_path),

      dealType: normalizeDealType(r),

      prices: {
        buy: buyAmount !== null ? { amount: buyAmount, currency: 'EUR' } : null,
        rent: rentAmount !== null ? { amount: rentAmount, currency: 'EUR', period: 'mo' } : null,
      },

      price: buyAmount !== null ? buyAmount : '',
      currency: 'EUR',
      isSold: Boolean(r.is_sold),
      soldAt: r.sold_at || null,
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
      owner_user_id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path,
      created_at,
      updated_at,
      EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.template_slug = seller_templates.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      ) AS is_sold,
      (
        SELECT MAX(o.created_at)
        FROM orders o
        WHERE o.template_slug = seller_templates.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      ) AS sold_at
    FROM seller_templates
    WHERE slug = $1
      AND status = 'published'
      AND deleted_at IS NULL
      -- Direct URL must not bypass exclusive BUY.
      AND NOT EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.template_slug = seller_templates.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      )
      -- Direct URL must not bypass active RENT reservation.
      AND NOT EXISTS (
        SELECT 1
        FROM public.entitlements e
        WHERE e.template_slug = seller_templates.slug
          AND UPPER(COALESCE(e.deal_type, e.kind, '')) = 'RENT'
          AND e.closed_at IS NULL
          AND (e.ends_at IS NULL OR e.ends_at > now())
          AND (e.ends_at IS NULL OR e.ends_at > NOW())
      )
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
    id,
    ownerUserId: r.owner_user_id || null,
    slug: slugStr,
    title: toStr(r.title || '').trim() || slugStr,
    name: toStr(r.title || '').trim() || slugStr,

    description: toStr(r.short_description || ''),

    // ✅ ALWAYS go through /t/<slug>/preview.png
    previewUrl: buildPreviewUrlBySlug(slugStr),

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
    isSold: Boolean(r.is_sold),
    soldAt: r.sold_at || null,
  };
}

export default {
  selectTemplatesForCatalog,
  getTemplateBySlug,
};

// TEMPASI_STEP_6E_BUY_EXCLUSIVITY_UI_ROUTE_CONTRACT
// Catalog visibility contract:
// Templates with a completed BUY must not be presented as normally available for BUY or RENT.
// Public gallery/details should expose a sold/unavailable state instead of active BUY/RENT CTAs.
