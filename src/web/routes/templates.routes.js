import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  normalizeTemplateAvailability,
  normalizeTemplateListAvailability,
} = require('../helpers/templateAvailability.cjs');
// src/web/routes/templates.routes.js
import { Router, urlencoded } from 'express';
import * as repo from '../../server/catalog/templates.repo.js';
import { getTemplateBySlug } from '../../server/catalog/templates.repo.js';

function getTemplateDetailsUserId(req) {
  return req.userId || req.user?.id || req.session?.userId || req.session?.user?.id || null;
}

// TEMPASI_CART_ERROR_MESSAGES (2026-08-15)
// /cart/add (cart.routes.js) redirects back here with ?cart=CODE on
// every rejection (owner's own template, already sold, license
// mismatch, etc.) — previously none of these codes were ever rendered
// into a visible message, so the redirect just looked like the page
// silently reloading ("flashes") with no explanation. This maps every
// code cart.routes.js can send to a human-readable message.
const CART_ERROR_MESSAGES = {
  unsupported: 'Unsupported purchase type.',
  bad_license: 'Invalid license selection.',
  rent_days_required: 'Choose how many days you want to rent for.',
  case_required: 'Select a client case to rent this template for.',
  owner_template: "You can't buy or rent your own template.",
  not_buyable: 'This template is not available to buy.',
  not_rentable: 'This template is not available to rent.',
  sold: 'This template has already been sold and is no longer available.',
  reserved: 'This template is currently reserved for another active rental.',
  case_not_owned: "That case doesn't belong to you.",
  owned: 'You already own this template.',
  buy_already_in_cart: 'This template is already in your cart.',
};

function pickCartErrorMessage(req) {
  const code = String(req.query?.cart || '').trim();
  return CART_ERROR_MESSAGES[code] || null;
}

// TEMPASI_CATALOG_CATEGORIES_FROM_DB (2026-07-21, corrected 2026-07-22)
// Was a hardcoded 10-item list duplicated here; categories are now
// admin-managed (Settings > Catalog, catalog_categories table).
// "Other" IS shown here (confirmed with the user 2026-07-22) — an
// earlier version of this fix excluded it by mistake.
const FALLBACK_CATEGORY_CHIPS = [
  { slug: 'landing', label: 'Landing pages' },
  { slug: 'ecommerce', label: 'E-commerce' },
  { slug: 'blog', label: 'Blog / Media' },
  { slug: 'portfolio', label: 'Portfolio' },
  { slug: 'saas', label: 'SaaS / IT' },
  { slug: 'restaurant', label: 'Restaurant / Caf\u00e9' },
  { slug: 'real-estate', label: 'Real estate' },
  { slug: 'education', label: 'Education' },
  { slug: 'events', label: 'Events' },
  { slug: 'health', label: 'Healthcare' },
  { slug: 'other', label: 'Other' },
];

async function getCatalogCategoryChips(db) {
  if (!db || typeof db.query !== 'function') return FALLBACK_CATEGORY_CHIPS;
  try {
    const { rows } = await db.query(
      "SELECT slug, label FROM catalog_categories ORDER BY (slug = 'other') ASC, label ASC",
    );
    return rows.length ? rows : FALLBACK_CATEGORY_CHIPS;
  } catch (e) {
    console.error('[templates.routes] failed to load catalog_categories, falling back:', e.message);
    return FALLBACK_CATEGORY_CHIPS;
  }
}

async function loadUserCasesForTemplateDetails(db, userId) {
  if (!db || typeof db.query !== 'function' || !userId) return [];

  try {
    const result = await db.query(
      `
        SELECT id, title
        FROM cases
        WHERE user_id = $1
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 20
      `,
      [String(userId)],
    );

    return (result.rows || []).map((row) => ({
      id: row.id,
      title: row.title || `Case #${row.id}`,
    }));
  } catch (_err) {
    return [];
  }
}

/**
 * This router MUST NOT crash the whole page rendering.
 * In tests / CI we prefer to show an empty catalog rather than HTTP 500
 * caused by repo export/interop issues.
 */

function isFn(v) {
  return typeof v === 'function';
}

function pickCatalogFnSafe() {
  try {
    // 1) Named exports
    if (isFn(repo.selectTemplatesForCatalog)) return repo.selectTemplatesForCatalog;
    if (isFn(repo.getTemplatesCatalog)) return repo.getTemplatesCatalog;

    // 2) Default export (common pattern: export default { ... })
    if (repo.default && isFn(repo.default.selectTemplatesForCatalog)) {
      return repo.default.selectTemplatesForCatalog;
    }
    if (repo.default && isFn(repo.default.getTemplatesCatalog)) {
      return repo.default.getTemplatesCatalog;
    }

    const available = Object.keys(repo).sort().join(', ');
    console.warn(
      `[templates.routes] Catalog function not found in templates.repo.js. ` +
        `Expected selectTemplatesForCatalog or getTemplatesCatalog. Available exports: ${available}. ` +
        `Falling back to empty catalog.`,
    );

    // ✅ fail-safe fallback
    return async function getEmptyCatalog() {
      return [];
    };
  } catch (e) {
    console.warn(
      `[templates.routes] Failed to pick catalog function: ${String(e?.message || e)}. ` +
        `Falling back to empty catalog.`,
    );
    return async function getEmptyCatalog() {
      return [];
    };
  }
}

// TEMPASI_CATALOG_PAGINATION (2026-08-13)
function pickCatalogPageFnSafe() {
  try {
    if (isFn(repo.selectTemplatesForCatalogPage)) return repo.selectTemplatesForCatalogPage;
    if (repo.default && isFn(repo.default.selectTemplatesForCatalogPage)) {
      return repo.default.selectTemplatesForCatalogPage;
    }

    console.warn(
      '[templates.routes] selectTemplatesForCatalogPage not found in templates.repo.js. ' +
        'Falling back to empty catalog page.',
    );

    return async function getEmptyCatalogPage() {
      return { rows: [], total: 0, page: 1, pageSize: 10, totalPages: 1 };
    };
  } catch (e) {
    console.warn(
      `[templates.routes] Failed to pick paginated catalog function: ${String(e?.message || e)}. ` +
        `Falling back to empty catalog page.`,
    );
    return async function getEmptyCatalogPage() {
      return { rows: [], total: 0, page: 1, pageSize: 10, totalPages: 1 };
    };
  }
}

const CATALOG_PAGE_SIZES = [10, 20, 30];
const CATALOG_DEFAULT_PAGE_SIZE = 10;

function normalizeCatalogPageSizeParam(input) {
  const n = Number.parseInt(input, 10);
  return CATALOG_PAGE_SIZES.includes(n) ? n : CATALOG_DEFAULT_PAGE_SIZE;
}

function normalizeCatalogPageParam(input) {
  const n = Number.parseInt(input, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function toCatsArray(input) {
  if (input === undefined || input === null || input === '') return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr.map((c) => toStr(c).trim()).filter(Boolean);
}

/**
 * Builds a /templates?... query string preserving the current filters
 * (q, cat[], priceMax/priceActive, pageSize) while overriding `page`.
 * Used both for the numbered pagination links and (later, if needed)
 * for any other same-page navigation.
 */
function buildCatalogPageUrl(filters, pagination, targetPage) {
  const params = new URLSearchParams();

  if (filters.q) params.set('q', filters.q);
  for (const c of filters.cats) params.append('cat', c);
  if (filters.priceActive && filters.priceMax !== null && filters.priceMax !== undefined) {
    params.set('priceMax', String(filters.priceMax));
    params.set('priceActive', '1');
  }
  if (pagination.pageSize !== CATALOG_DEFAULT_PAGE_SIZE) {
    params.set('pageSize', String(pagination.pageSize));
  }
  if (targetPage && targetPage !== 1) {
    params.set('page', String(targetPage));
  }

  const qs = params.toString();
  return `/templates${qs ? `?${qs}` : ''}`;
}

function buildCatalogPagination(filters, result) {
  const { page, pageSize, total, totalPages } = result;

  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, Math.min(start, Math.max(1, end - windowSize + 1)));

  const pages = [];
  for (let p = start; p <= end; p += 1) {
    pages.push({
      page: p,
      url: buildCatalogPageUrl(filters, { pageSize }, p),
      isCurrent: p === page,
    });
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages,
    rangeStart,
    rangeEnd,
    pages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prevUrl: page > 1 ? buildCatalogPageUrl(filters, { pageSize }, page - 1) : '',
    nextUrl: page < totalPages ? buildCatalogPageUrl(filters, { pageSize }, page + 1) : '',
    pageSizeOptions: CATALOG_PAGE_SIZES.map((size) => ({
      value: size,
      isCurrent: size === pageSize,
      url: buildCatalogPageUrl(filters, { pageSize: size }, 1),
    })),
  };
}

function pickBySlugFnSafe() {
  try {
    // Named exports (preferred)
    if (isFn(repo.getTemplateBySlug)) return repo.getTemplateBySlug;
    if (isFn(repo.selectTemplateBySlug)) return repo.selectTemplateBySlug;
    if (isFn(repo.findTemplateBySlug)) return repo.findTemplateBySlug;

    // Default export variants
    if (repo.default && isFn(repo.default.getTemplateBySlug)) return repo.default.getTemplateBySlug;
    if (repo.default && isFn(repo.default.selectTemplateBySlug))
      return repo.default.selectTemplateBySlug;
    if (repo.default && isFn(repo.default.findTemplateBySlug))
      return repo.default.findTemplateBySlug;

    // No slug function is OK (we have fallback: load catalog + find)
    return null;
  } catch (e) {
    console.warn(
      `[templates.routes] Failed to pick by-slug function: ${String(e?.message || e)}. ` +
        `Falling back to catalog-scan by slug.`,
    );
    return null;
  }
}

async function loadPublicSellerProfile(db, ownerUserId) {
  if (!db || typeof db.query !== 'function' || !ownerUserId) {
    return null;
  }

  const { rows } = await db.query(
    `
      SELECT
        full_name,
        nickname,
        about,
        public_email
      FROM user_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [ownerUserId],
  );

  const row = rows && rows[0] ? rows[0] : null;
  if (!row) return null;

  const name = String(row.full_name || '').trim();
  const nickname = String(row.nickname || '').trim();
  const bio = String(row.about || '').trim();
  const publicEmail = String(row.public_email || '').trim();

  if (!name && !nickname && !bio && !publicEmail) {
    return null;
  }

  return {
    // Canonical fields used by template-details.hbs
    full_name: name,
    nickname,
    about: bio,
    public_email: publicEmail,

    // Backward-compatible aliases for older view/route code
    name,
    bio,
    publicEmail,
  };
}

function toStr(v) {
  return v == null ? '' : String(v);
}

function normalizeCaseIdParam(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  // UUID cases are current production shape, but keep numeric test fixtures valid too.
  if (/^[0-9a-fA-F-]{8,64}$/.test(raw) || /^[1-9][0-9]*$/.test(raw)) return raw;
  return '';
}

function appendCaseContextToTemplates(templates, selectedCaseId) {
  const caseId = normalizeCaseIdParam(selectedCaseId);
  if (!caseId) return templates;
  const caseParam = `caseId=${encodeURIComponent(caseId)}`;
  return (templates || []).map((template) => ({
    ...template,
    selectedCaseId: caseId,
    selectedCaseParam: caseParam,
  }));
}

function toEpochMs(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  const n = d.getTime();
  return Number.isFinite(n) ? String(n) : '';
}

function normalizeTemplate(raw, slugFromUrl) {
  const meta = raw?.meta || raw?.metadata || raw?.data || raw || {};

  // id can be numeric or string; keep string for URLs
  const id = toStr(raw?.id || meta?.id).trim();

  const slug = toStr(raw?.slug || raw?.id || meta?.slug || slugFromUrl).trim();
  const title =
    toStr(raw?.title).trim() ||
    toStr(raw?.name).trim() ||
    toStr(meta?.title).trim() ||
    toStr(meta?.name).trim() ||
    slug;

  // ✅ Preview (MVP): deterministic local path
  // Stored at: public/uploads/previews/<templateId>.png
  // Served as: /uploads/previews/<templateId>.png
  // Add cache-buster so after ZIP replace browser doesn't keep old image
  const updatedAt =
    raw?.updated_at || raw?.updatedAt || meta?.updated_at || meta?.updatedAt || null;
  const v = toEpochMs(updatedAt);

  const deterministicPreview = id
    ? `/uploads/previews/${encodeURIComponent(id)}.png${v ? `?v=${v}` : ''}`
    : '';

  const previewUrl =
    toStr(raw?.previewUrl).trim() ||
    toStr(meta?.previewUrl).trim() ||
    toStr(meta?.preview).trim() ||
    deterministicPreview ||
    `/t/${slug}/preview.png`;

  // Demo: allow explicit demoUrl, fallback to internal live preview endpoint
  const demoUrl = toStr(raw?.demoUrl || meta?.demoUrl).trim() || '';

  // Prices: support both legacy {price, currency} and contract {prices:{buy,rent}}
  const prices = raw?.prices || meta?.prices;
  const legacyPrice = raw?.price ?? meta?.price ?? '';
  const legacyCurrency = toStr(raw?.currency || meta?.currency || 'EUR').trim() || 'EUR';

  const buy = prices?.buy
    ? {
        amount: prices.buy.amount,
        currency: toStr(prices.buy.currency || legacyCurrency || 'EUR'),
      }
    : legacyPrice !== ''
      ? {
          amount: legacyPrice,
          currency: legacyCurrency,
        }
      : null;

  const rent = prices?.rent
    ? {
        amount: prices.rent.amount,
        currency: toStr(prices.rent.currency || legacyCurrency || 'EUR'),
        period: toStr(prices.rent.period || 'mo'),
      }
    : null;

  // Zip flag: support different shapes
  const hasZip =
    Boolean(raw?.hasZip) ||
    Boolean(raw?.zipReady) ||
    Boolean(meta?.hasZip) ||
    Boolean(meta?.zipReady);

  // Other info
  const category = toStr(raw?.category || meta?.category).trim() || '';
  // TEMPASI_CATALOG_REACTIVE_FILTERS (2026-08-10): pass through the raw
  // category slug (distinct from the display label above) so the
  // catalog page's client-side filter JS can match it against the
  // category checkbox values.
  const categorySlug = toStr(raw?.categorySlug || meta?.categorySlug).trim() || '';
  const license = toStr(raw?.license || meta?.license).trim() || '';
  const type = toStr(raw?.type || meta?.type).trim() || '';
  const version = toStr(raw?.version || meta?.version).trim() || '';

  const description =
    toStr(raw?.description).trim() ||
    toStr(meta?.description).trim() ||
    toStr(meta?.excerpt).trim() ||
    '';

  const longDescription =
    toStr(raw?.longDescription).trim() || toStr(meta?.longDescription).trim() || '';

  const tech = Array.isArray(raw?.tech) ? raw.tech : Array.isArray(meta?.tech) ? meta.tech : null;

  const author = raw?.authorName || raw?.author || meta?.author || null;

  const features = Array.isArray(raw?.features)
    ? raw.features
    : Array.isArray(meta?.features)
      ? meta.features
      : null;

  const isSold =
    Boolean(raw?.isSold) ||
    Boolean(raw?.is_sold) ||
    Boolean(meta?.isSold) ||
    Boolean(meta?.is_sold);

  const soldAt = raw?.soldAt || raw?.sold_at || meta?.soldAt || meta?.sold_at || null;

  return {
    id,
    slug,
    title,
    category,
    categorySlug,
    license,
    type,
    version,
    description,
    longDescription,
    tech,
    author,
    features,
    previewUrl,
    demoUrl,
    prices: {
      buy,
      rent,
    },
    // legacy fields (some older pages may still use them)
    price: legacyPrice !== '' ? legacyPrice : buy ? buy.amount : '',
    currency: legacyCurrency,
    hasZip,
    isSold,
    soldAt,
    // TEMPASI_CATALOG_OWNER_AWARE_CARDS (2026-08-15): needed by the
    // catalog route's per-template isOwner computation. Wasn't
    // carried through before — the details route worked around this
    // by reading raw.ownerUserId directly (before normalization)
    // instead of from this returned object.
    ownerUserId: raw?.ownerUserId ?? raw?.owner_user_id ?? null,
  };
}

function getUserId(req) {
  const raw =
    req?.user?.id ??
    req?.user?.user_id ??
    req?.user?.userId ??
    req?.userId ??
    req?.session?.userId ??
    req?.session?.user_id ??
    null;

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeOwnerHoldDays(input) {
  const n = Number.parseInt(String(input || '1'), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 30);
}

async function loadOwnerTemplateForAction(db, slug, userId) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('DB_NOT_CONFIGURED');
  }

  const { rows } = await db.query(
    `
      SELECT id, slug, owner_user_id, status, deleted_at
      FROM seller_templates
      WHERE slug = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [slug],
  );

  const template = rows && rows[0] ? rows[0] : null;

  if (!template) return null;
  if (Number(template.owner_user_id) !== Number(userId)) return null;

  return template;
}

function normalizeDemoBackUrl(value, fallback = '/') {
  const raw = toStr(value).trim();

  if (!raw) return fallback;

  // Only same-site relative URLs are allowed.
  // This prevents open redirects like https://evil.example.
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;

  return raw;
}

export function createTemplatesRouter() {
  const router = Router();

  router.use(urlencoded({ extended: false }));

  const selectCatalog = pickCatalogFnSafe();
  const selectCatalogPage = pickCatalogPageFnSafe();
  const getBySlug = pickBySlugFnSafe();

  // /templates — catalog (server-side filtered + paginated)
  router.get('/', async (req, res, next) => {
    const selectedCaseId = normalizeCaseIdParam(req.query?.caseId || req.query?.case_id);
    const selectedCaseParam = selectedCaseId ? `caseId=${encodeURIComponent(selectedCaseId)}` : '';
    const listingUserId = getTemplateDetailsUserId(req);

    // Sticky filter state, read straight from query params — also used
    // to re-check the right chips/radio and to build pagination links
    // that don't drop the active filters.
    const filters = {
      q: toStr(req.query?.q).trim(),
      cats: toCatsArray(req.query?.cat),
      // priceActive only becomes true once the user has actually
      // touched the price slider/number field client-side (see
      // templates.catalog-filters.js) — mirrors the old client-side
      // filter's behavior of not treating the slider's default
      // resting value as an implied filter.
      priceActive: req.query?.priceActive === '1',
      priceMax:
        req.query?.priceMax !== undefined &&
        req.query?.priceMax !== '' &&
        !Number.isNaN(Number(req.query.priceMax))
          ? Number(req.query.priceMax)
          : null,
    };

    const requestedPage = normalizeCatalogPageParam(req.query?.page);
    const requestedPageSize = normalizeCatalogPageSizeParam(req.query?.pageSize);

    try {
      const db = req.app.locals?.db;

      const result = await selectCatalogPage(db, filters, {
        page: requestedPage,
        pageSize: requestedPageSize,
      });

      const templates = appendCaseContextToTemplates(
        normalizeTemplateListAvailability((result.rows || []).map((t) => normalizeTemplate(t))),
        selectedCaseId,
      ).map((t) => {
        // TEMPASI_CATALOG_OWNER_AWARE_CARDS (2026-08-15): same isOwner
        // computation the details route already does for a single
        // template (see below in this file) — applied per-row here so
        // template-card.v2.hbs can hide Buy/Rent and show "Your
        // template" instead, matching what the details page already
        // does. Previously the catalog grid showed Buy/Rent on every
        // card regardless of ownership, so an owner could open the
        // Rent modal, fill it in, and only find out it was rejected
        // after submitting — the modal is correct, but this is a
        // clearer fix: don't offer the action at all.
        t.isOwner = Boolean(listingUserId && Number(t.ownerUserId) === Number(listingUserId));
        return t;
      });

      const categoryOptionsRaw = await getCatalogCategoryChips(db);
      const categoryOptions = categoryOptionsRaw.map((opt) => ({
        ...opt,
        checked: filters.cats.includes(opt.slug),
      }));

      const userCases = await loadUserCasesForTemplateDetails(db, listingUserId);
      const pagination = buildCatalogPagination(filters, result);

      res.render('pages/templates/index', {
        title: 'Templates — Tempasi',
        bodyClass: 'templates-page',
        activePage: 'templates',
        styles: ['/css/pages/catalog.css', '/css/pages/templates.css'],
        templates,
        categoryOptions,
        isAuthenticated: Boolean(listingUserId),
        userCases,
        selectedCaseId,
        selectedCaseParam,
        query: filters,
        pagination,
        cartErrorMessage: pickCartErrorMessage(req),
      });
    } catch (err) {
      // ✅ Hard fail-safe: never 500 for catalog
      console.warn(
        `[templates.routes] GET /templates failed: ${String(err?.message || err)}. Rendering empty catalog.`,
      );
      try {
        const emptyResult = {
          rows: [],
          total: 0,
          page: 1,
          pageSize: requestedPageSize,
          totalPages: 1,
        };
        return res.status(200).render('pages/templates/index', {
          title: 'Templates — Tempasi',
          bodyClass: 'templates-page',
          activePage: 'templates',
          styles: ['/css/pages/catalog.css', '/css/pages/templates.css'],
          templates: [],
          categoryOptions: FALLBACK_CATEGORY_CHIPS.map((opt) => ({ ...opt, checked: false })),
          isAuthenticated: Boolean(listingUserId),
          userCases: [],
          selectedCaseId,
          selectedCaseParam,
          query: filters,
          pagination: buildCatalogPagination(filters, emptyResult),
          cartErrorMessage: pickCartErrorMessage(req),
        });
      } catch (e2) {
        return next(e2);
      }
    }
  });

  router.post('/:slug/owner/reserve', async (req, res, next) => {
    try {
      const slug = toStr(req.params.slug).trim();
      const userId = getUserId(req);
      const db = req.app.locals?.db;

      if (!userId)
        return res.redirect(302, `/login?next=${encodeURIComponent(`/templates/${slug}`)}`);

      const template = await loadOwnerTemplateForAction(db, slug, userId);
      if (!template)
        return res.redirect(302, `/templates/${encodeURIComponent(slug)}?owner=forbidden`);

      const days = normalizeOwnerHoldDays(req.body?.owner_hold_days);
      if (!days) return res.redirect(302, `/templates/${encodeURIComponent(slug)}?owner=bad_days`);

      const reason = String(req.body?.owner_hold_reason || 'Client presentation')
        .trim()
        .slice(0, 300);

      await db.query(
        `
          UPDATE seller_templates
          SET owner_hold_until = NOW() + ($2::int * INTERVAL '1 day'),
              owner_hold_days = $2,
              owner_hold_reason = $3,
              updated_at = NOW()
          WHERE slug = $1
            AND owner_user_id = $4
            AND deleted_at IS NULL
        `,
        [slug, days, reason || null, userId],
      );

      return res.redirect(302, '/cabinet/my-templates?owner_reserved=1');
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:slug/owner/withdraw', async (req, res, next) => {
    try {
      const slug = toStr(req.params.slug).trim();
      const userId = getUserId(req);
      const db = req.app.locals?.db;

      if (!userId)
        return res.redirect(302, `/login?next=${encodeURIComponent(`/templates/${slug}`)}`);

      const template = await loadOwnerTemplateForAction(db, slug, userId);
      if (!template)
        return res.redirect(302, `/templates/${encodeURIComponent(slug)}?owner=forbidden`);

      const reason = String(req.body?.owner_withdraw_reason || 'Sold externally')
        .trim()
        .slice(0, 300);

      await db.query(
        `
          UPDATE seller_templates
          SET owner_withdrawn_at = NOW(),
              owner_withdraw_reason = $2,
              owner_hold_until = NULL,
              owner_hold_days = NULL,
              owner_hold_reason = NULL,
              updated_at = NOW()
          WHERE slug = $1
            AND owner_user_id = $3
            AND deleted_at IS NULL
        `,
        [slug, reason || null, userId],
      );

      return res.redirect(302, '/cabinet/my-templates?owner_withdrawn=1');
    } catch (err) {
      return next(err);
    }
  });

  // /templates/:slug — details page
  router.get('/:slug/demo', async (req, res, next) => {
    try {
      const db = req.app.locals.db;
      const slug = toStr(req.params.slug).trim();
      const currentUserId = getUserId(req);
      const raw = await getTemplateBySlug(db, slug, { viewerUserId: currentUserId });

      if (!raw) {
        return res.status(404).render('pages/template', {
          title: 'Template not found — Tempasi',
          bodyClass: 'page-template',
          activePage: 'templates',
          styles: ['/css/pages/template-details.css'],
          slug,
        });
      }

      const template = normalizeTemplateAvailability(normalizeTemplate(raw), slug);
      template.isOwner = Boolean(
        currentUserId && Number(raw.ownerUserId || raw.owner_user_id) === Number(currentUserId),
      );

      // TEMPASI_DEMO_FRAME_URL (2026-08-04)
      // Points directly at src/index.html under
      // TEMPLATE_UPLOAD_DIR/<slug>/ (served by the /t/:slug/* route
      // in app.web.js). No more /demo/ segment and no more
      // redirect-stub index.html — the old ingest pipeline used to
      // generate a top-level index.html that just did
      // location.replace('./src/'); the new upload-time extraction
      // doesn't bother with that indirection, since nothing else
      // depends on a bare /t/<slug>/index.html existing.
      const demoFrameUrl =
        template.demoUrl ||
        `/t/${encodeURIComponent(String(template.slug || slug))}/src/index.html`;
      const templateDetailsUrl = `/templates/${encodeURIComponent(String(template.slug || slug))}`;
      const demoBackUrl = normalizeDemoBackUrl(req.query?.back, templateDetailsUrl);

      return res.status(200).render('pages/template-demo', {
        title: `${template.title} — Live Demo — Tempasi`,
        bodyClass: 'page-template-demo',
        activePage: 'templates',
        styles: ['/css/pages/template-demo.css'],
        template,
        demoFrameUrl,
        templateDetailsUrl,
        demoBackUrl,
        isOwner: Boolean(template.isOwner),
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:slug', async (req, res, next) => {
    try {
      const slug = toStr(req.params.slug).trim();
      const db = req.app.locals?.db;
      const currentUserId = getUserId(req);

      let raw = null;

      // Prefer direct repo function if present
      if (getBySlug) {
        raw = await (getBySlug.length >= 2
          ? getBySlug(db, slug, { viewerUserId: currentUserId })
          : getBySlug(slug));
      } else {
        // Fallback: load catalog and find
        const list = await (selectCatalog.length >= 1 ? selectCatalog(db) : selectCatalog());
        raw = (list || []).find((t) => t?.slug === slug || t?.id === slug) || null;
      }

      if (!raw) {
        return res.status(404).render('pages/template-not-found', {
          title: 'Template not found — Tempasi',
          bodyClass: 'page-template-details',
          activePage: 'templates',
          styles: ['/css/pages/template-details.css'],
          slug,
        });
      }

      const template = normalizeTemplateAvailability(normalizeTemplate(raw), slug);
      template.isOwner = Boolean(
        currentUserId && Number(raw.ownerUserId || raw.owner_user_id) === Number(currentUserId),
      );
      template.ownerEditHref =
        template.isOwner && raw.id
          ? `/cabinet/my-templates/${encodeURIComponent(String(raw.id))}/edit`
          : '';
      template.author = await loadPublicSellerProfile(db, raw.ownerUserId || raw.owner_user_id);

      const templateDetailsUserId = getTemplateDetailsUserId(req);
      const selectedCaseId = normalizeCaseIdParam(req.query?.caseId || req.query?.case_id);
      const templateDetailsCases = (
        await loadUserCasesForTemplateDetails(db, templateDetailsUserId)
      ).map((item) => ({
        ...item,
        isSelected: selectedCaseId && String(item.id) === String(selectedCaseId),
      }));

      return res.status(200).render('pages/template-details', {
        title: `${template.title} — Tempasi`,
        bodyClass: 'page-template-details',
        activePage: 'templates',
        styles: ['/css/pages/template-details.css'],
        template,
        sellerProfile: template.author,
        cases: templateDetailsCases || [],
        selectedCaseId,
        selectedCaseParam: selectedCaseId ? `caseId=${encodeURIComponent(selectedCaseId)}` : '',
        isAuthenticated: Boolean(templateDetailsUserId),
        isOwner: Boolean(template.isOwner),
        cartErrorMessage: pickCartErrorMessage(req),
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

// TEMPASI_STEP_6F_REAL_UI_SOLD_UNAVAILABLE_BEHAVIOR
// Route contract:
// Template detail/list routes must pass UI-normalized availability fields:
// template.isSold, template.canBuy, template.canRent.
// A completed BUY must be rendered as sold/unavailable and must not expose active BUY/RENT CTA.
