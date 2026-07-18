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

  const author = raw?.author || meta?.author || null;

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
  const getBySlug = pickBySlugFnSafe();

  // /templates — catalog
  router.get('/', async (req, res, next) => {
    try {
      const db = req.app.locals?.db;

      // Some repo functions accept db; some don't.
      const rawList = await (selectCatalog.length >= 1 ? selectCatalog(db) : selectCatalog());

      const selectedCaseId = normalizeCaseIdParam(req.query?.caseId || req.query?.case_id);

      // ✅ normalize previewUrl + compat fields for cards
      const templates = appendCaseContextToTemplates(
        normalizeTemplateListAvailability((rawList || []).map((t) => normalizeTemplate(t))),
        selectedCaseId,
      );

      res.render('pages/templates/index', {
        title: 'Templates — Tempasi',
        bodyClass: 'templates-page',
        activePage: 'templates',
        styles: ['/css/pages/catalog.css', '/css/pages/templates.css'],
        templates,
        selectedCaseId,
        selectedCaseParam: selectedCaseId ? `caseId=${encodeURIComponent(selectedCaseId)}` : '',
      });
    } catch (err) {
      // ✅ Hard fail-safe: never 500 for catalog
      console.warn(
        `[templates.routes] GET /templates failed: ${String(err?.message || err)}. Rendering empty catalog.`,
      );
      try {
        return res.status(200).render('pages/templates/index', {
          title: 'Templates — Tempasi',
          bodyClass: 'templates-page',
          activePage: 'templates',
          styles: ['/css/pages/catalog.css', '/css/pages/templates.css'],
          templates: [],
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

      const demoFrameUrl =
        template.demoUrl ||
        `/t/${encodeURIComponent(String(template.slug || slug))}/demo/index.html`;
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
