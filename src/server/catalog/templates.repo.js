// src/server/catalog/templates.repo.js

function toStr(v) {
  return v == null ? '' : String(v);
}

function normalizePreviewUrl(row) {
  const slug = String(row?.slug || '').trim();

  if (/^seed-\d{3}$/.test(slug)) {
    return `/img/templates/${slug}.svg`;
  }

  const raw =
    row?.preview_url ||
    row?.preview_image ||
    row?.previewUrl ||
    row?.preview_path ||
    row?.previewPath ||
    '';

  return String(raw || '').trim();
}

function resolveStoredTemplatePreviewUrl(row) {
  const slug = String(row?.slug || '').trim();

  const directPreview = String(
    row?.preview_url || row?.preview_image || row?.preview_path || row?.previewUrl || '',
  ).trim();

  if (directPreview) {
    if (directPreview.startsWith('/')) return directPreview;

    const previewFile = directPreview.match(/preview\.(png|jpg|jpeg|webp|svg)$/i);
    if (slug && previewFile) {
      return `/t/${encodeURIComponent(slug)}/preview/preview.${previewFile[1].toLowerCase()}`;
    }

    return `/${directPreview.replace(/^\/+/, '')}`;
  }

  const zipPath = String(row?.zip_path || row?.zipPath || '').trim();

  if (slug && zipPath) {
    return `/t/${encodeURIComponent(slug)}/preview/preview.png`;
  }

  return '';
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

// TEMPASI_CATALOG_PAGINATION (2026-08-13)
// Shared row -> view-model mapper, used by both the legacy unpaginated
// selectTemplatesForCatalog() (kept as-is for existing callers/tests
// that scan the whole catalog) and the new paginated
// selectTemplatesForCatalogPage() below. Keeping this in one place
// avoids the two functions' mapping logic drifting apart.
function mapCatalogRow(r) {
  const buyAmount = centsToMoney(r.price_buy_cents);
  const rentAmount = centsToMoney(r.price_rent_cents);

  const id = r.id;
  const slug = toStr(r.slug || '').trim();

  return {
    id,
    ownerUserId: r.owner_user_id || null,

    slug,
    title: toStr(r.title || '').trim() || slug,
    name: toStr(r.title || '').trim() || slug,

    description: toStr(r.short_description || ''),
    shortDescription: toStr(r.short_description || ''),
    fullDescription: toStr(r.description || ''),
    category: toStr(r.category_label || r.category || ''),
    categorySlug: toStr(r.category || ''),
    authorName: toStr(r.author_name || ''),

    previewUrl: resolveStoredTemplatePreviewUrl(r),
    demoUrl: toStr(r.demo_url || '').trim() || `/preview/${encodeURIComponent(slug)}`,

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

const CATALOG_PAGE_SIZES = [10, 20, 30];
const CATALOG_DEFAULT_PAGE_SIZE = 10;

function normalizeCatalogPageSize(input) {
  const n = Number.parseInt(input, 10);
  return CATALOG_PAGE_SIZES.includes(n) ? n : CATALOG_DEFAULT_PAGE_SIZE;
}

function normalizeCatalogPage(input) {
  const n = Number.parseInt(input, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Public catalog (DB-backed), filtered + paginated server-side.
 * Rule: show ONLY published + not deleted (same visibility rules as
 * selectTemplatesForCatalog below).
 *
 * filters:
 *   q          - free-text search over title/slug
 *   cats       - array of category slugs (OR'ed together)
 *   priceMax   - number (EUR); only applied when priceActive is true
 *   priceActive- whether the price cap should be applied at all
 *
 * pagination:
 *   page       - 1-based page number
 *   pageSize   - one of CATALOG_PAGE_SIZES (10/20/30), default 10
 */
export async function selectTemplatesForCatalogPage(db, filters = {}, pagination = {}) {
  const pool = requireDb(db);

  const q = toStr(filters.q).trim();
  const cats = Array.isArray(filters.cats)
    ? filters.cats.map((c) => toStr(c).trim()).filter(Boolean)
    : [];
  const priceActive =
    Boolean(filters.priceActive) &&
    filters.priceMax !== null &&
    filters.priceMax !== undefined &&
    Number.isFinite(Number(filters.priceMax));
  const priceMaxCents = priceActive ? Math.round(Number(filters.priceMax) * 100) : null;

  const page = normalizeCatalogPage(pagination.page);
  const pageSize = normalizeCatalogPageSize(pagination.pageSize);

  const params = [];
  const extraWhere = [];

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    extraWhere.push(`(st.title ILIKE $${idx} OR st.slug ILIKE $${idx})`);
  }

  if (cats.length) {
    params.push(cats);
    const idx = params.length;
    extraWhere.push(`st.category = ANY($${idx}::text[])`);
  }

  // TEMPASI_REQUIRE_BOTH_PRICES (2026-08-13): the Access filter
  // (Buy+Rent vs Buy only) was removed from the catalog sidebar —
  // every new template now always has both a buy and a rent price
  // (see sellerTemplates.service.cjs), so the filter no longer
  // distinguishes anything meaningful going forward. Existing legacy
  // "Buy only" rows (price_rent_cents IS NULL) still show up fine,
  // they just won't have a Rent price on their card.

  if (priceActive) {
    params.push(priceMaxCents);
    const idx = params.length;
    extraWhere.push(`(st.price_buy_cents IS NULL OR st.price_buy_cents <= $${idx})`);
  }

  const extraSql = extraWhere.length ? `AND ${extraWhere.join(' AND ')}` : '';

  // Same visibility rules as selectTemplatesForCatalog() below: hides
  // sold/rent-held/cart-held templates. Since sold templates are
  // already excluded here, is_sold/sold_at are always false/null for
  // rows returned by this function (unlike the legacy function, which
  // still computes them for compatibility with older callers).
  const fromWhereSql = `
    FROM seller_templates st
    LEFT JOIN users u ON u.id = st.owner_user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN catalog_categories cc ON cc.slug = st.category
    WHERE st.status = 'published'
      AND st.deleted_at IS NULL
      AND st.owner_withdrawn_at IS NULL
      AND st.admin_blocked_at IS NULL
      AND (st.owner_hold_until IS NULL OR st.owner_hold_until <= NOW())
      AND NOT EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.template_slug = st.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.entitlements e
        WHERE e.template_slug = st.slug
          AND UPPER(COALESCE(e.deal_type, e.kind, '')) = 'RENT'
          AND e.closed_at IS NULL
          AND (e.ends_at IS NULL OR e.ends_at > now())
      )
      AND NOT EXISTS (
        SELECT 1
        FROM cart_items ci_public_cart_hold
        WHERE ci_public_cart_hold.template_slug = st.slug
          AND (
            ci_public_cart_hold.license = 'BUY'
            OR ci_public_cart_hold.license = 'RENT'
            OR ci_public_cart_hold.license = 'PU'
            OR ci_public_cart_hold.license ~ '^PU:[1-9][0-9]*d$'
          )
      )
      ${extraSql}
  `;

  const countQ = `SELECT COUNT(*)::int AS total ${fromWhereSql}`;
  const countRes = await pool.query(countQ, params);
  const total = (countRes.rows && countRes.rows[0] && countRes.rows[0].total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const listQ = `
    SELECT
      st.id,
      st.owner_user_id,
      st.title,
      st.slug,
      st.short_description,
      st.description,
      st.preview_image,
      st.preview_url,
      st.demo_url,
      st.category,
      st.price_buy_cents,
      st.price_rent_cents,
      st.status,
      st.zip_path,
      st.created_at,
      st.updated_at,
      COALESCE(NULLIF(TRIM(up.nickname), ''), NULLIF(TRIM(up.full_name), ''), u.email) AS author_name,
      COALESCE(cc.label, st.category) AS category_label,
      FALSE AS is_sold,
      NULL::timestamptz AS sold_at
    ${fromWhereSql}
    ORDER BY st.created_at DESC, st.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await pool.query(listQ, [...params, pageSize, offset]);

  return {
    rows: (rows || []).map(mapCatalogRow),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

/**
 * Public catalog (DB-backed).
 * Rule: show ONLY published + not deleted.
 */
export async function selectTemplatesForCatalog(db) {
  const pool = requireDb(db);

  const q = `
    SELECT
      st.id,
      st.owner_user_id,
      st.title,
      st.slug,
      st.short_description,
      st.description,
      st.preview_image,
      st.preview_url,
      st.demo_url,
      st.category,
      st.price_buy_cents,
      st.price_rent_cents,
      st.status,
      st.zip_path,
      st.created_at,
      st.updated_at,
      COALESCE(NULLIF(TRIM(up.nickname), ''), NULLIF(TRIM(up.full_name), ''), u.email) AS author_name,
      COALESCE(cc.label, st.category) AS category_label,
      EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.template_slug = st.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      ) AS is_sold,
      (
        SELECT MAX(o.created_at)
        FROM orders o
        WHERE o.template_slug = st.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      ) AS sold_at
    FROM seller_templates st
    LEFT JOIN users u ON u.id = st.owner_user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN catalog_categories cc ON cc.slug = st.category
    WHERE st.status = 'published'
      AND st.deleted_at IS NULL
      AND st.owner_withdrawn_at IS NULL
      AND st.admin_blocked_at IS NULL
      AND (st.owner_hold_until IS NULL OR st.owner_hold_until <= NOW())
      -- Hide templates already bought exclusively.
      AND NOT EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.template_slug = st.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
      )
      -- Hide templates currently reserved by active RENT.
      AND NOT EXISTS (
        SELECT 1
        FROM public.entitlements e
        WHERE e.template_slug = st.slug
          AND UPPER(COALESCE(e.deal_type, e.kind, '')) = 'RENT'
          AND e.closed_at IS NULL
          AND (e.ends_at IS NULL OR e.ends_at > now())
          AND (e.ends_at IS NULL OR e.ends_at > NOW())
      )
    AND NOT EXISTS (
      SELECT 1
      FROM cart_items ci_public_cart_hold
      WHERE ci_public_cart_hold.template_slug = st.slug
        AND (
          ci_public_cart_hold.license = 'BUY'
          OR ci_public_cart_hold.license = 'RENT'
          OR ci_public_cart_hold.license = 'PU'
          OR ci_public_cart_hold.license ~ '^PU:[1-9][0-9]*d$'
        )
    )

    ORDER BY st.created_at DESC, st.id DESC
    LIMIT 200
  `;

  const { rows } = await pool.query(q, []);
  return (rows || []).map(mapCatalogRow);
}

/**
 * Public details by slug (DB-backed).
 * Rule: draft MUST be invisible (404), only published + not deleted.
 */
export async function getTemplateBySlug(db, slug, options = {}) {
  const pool = requireDb(db);
  const s = toStr(slug).trim();
  if (!s) return null;

  const viewerUserId =
    options && options.viewerUserId !== undefined && options.viewerUserId !== null
      ? String(options.viewerUserId).trim()
      : '';

  const q = `
    SELECT
      id,
      owner_user_id,
      title,
      slug,
      short_description,
      description,
      preview_image,
      preview_url,
      demo_url,
      category,
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
      AND owner_withdrawn_at IS NULL
      AND admin_blocked_at IS NULL
      AND (owner_hold_until IS NULL OR owner_hold_until <= NOW())
      -- Direct URL must not bypass exclusive BUY for other users.
      -- The actual BUY owner may still open details.
      AND NOT EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.template_slug = seller_templates.slug
          AND o.deal_type = 'BUY'
          AND o.status = 'paid'
          AND ($2::text = '' OR o.user_id::text <> $2::text)
      )
      -- Direct URL must not bypass active RENT reservation for other users.
      -- The active renter may still open details from Cabinet/Case View.
      AND NOT EXISTS (
        SELECT 1
        FROM public.entitlements e
        WHERE e.template_slug = seller_templates.slug
          AND UPPER(COALESCE(e.deal_type, e.kind, '')) = 'RENT'
          AND e.closed_at IS NULL
          AND (e.ends_at IS NULL OR e.ends_at > NOW())
          AND ($2::text = '' OR e.user_id::text <> $2::text)
      )
    AND NOT EXISTS (
      SELECT 1
      FROM cart_items ci_public_cart_hold
      WHERE ci_public_cart_hold.template_slug = seller_templates.slug
        AND (
          ci_public_cart_hold.license = 'BUY'
          OR ci_public_cart_hold.license = 'RENT'
          OR ci_public_cart_hold.license = 'PU'
          OR ci_public_cart_hold.license ~ '^PU:[1-9][0-9]*d$'
        )
        AND ($2::text = '' OR ci_public_cart_hold.user_id::text <> $2::text)
    )

    LIMIT 1
  `;

  const { rows } = await pool.query(q, [s, viewerUserId]);
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
    shortDescription: toStr(r.short_description || ''),
    fullDescription: toStr(r.description || ''),
    category: toStr(r.category || ''),

    // ✅ ALWAYS go through /t/<slug>/preview.png
    previewUrl: resolveStoredTemplatePreviewUrl(r),

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
  selectTemplatesForCatalogPage,
  getTemplateBySlug,
};

// TEMPASI_STEP_6E_BUY_EXCLUSIVITY_UI_ROUTE_CONTRACT
// Catalog visibility contract:
// Templates with a completed BUY must not be presented as normally available for BUY or RENT.
// Public gallery/details should expose a sold/unavailable state instead of active BUY/RENT CTAs.
