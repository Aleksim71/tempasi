// src/web/routes/templates.routes.js
import { Router } from 'express';
import * as repo from '../../server/catalog/templates.repo.js';

function pickCatalogFn() {
  // 1) Named exports
  if (typeof repo.selectTemplatesForCatalog === 'function') return repo.selectTemplatesForCatalog;
  if (typeof repo.getTemplatesCatalog === 'function') return repo.getTemplatesCatalog;

  // 2) Default export (common pattern: export default { ... })
  if (repo.default && typeof repo.default.selectTemplatesForCatalog === 'function') {
    return repo.default.selectTemplatesForCatalog;
  }
  if (repo.default && typeof repo.default.getTemplatesCatalog === 'function') {
    return repo.default.getTemplatesCatalog;
  }

  const available = Object.keys(repo).sort().join(', ');
  throw new Error(
    `[templates.routes] Cannot find catalog function in templates.repo.js. ` +
      `Expected selectTemplatesForCatalog or getTemplatesCatalog. Available exports: ${available}`,
  );
}

function pickBySlugFn() {
  // Named exports (preferred)
  if (typeof repo.getTemplateBySlug === 'function') return repo.getTemplateBySlug;
  if (typeof repo.selectTemplateBySlug === 'function') return repo.selectTemplateBySlug;
  if (typeof repo.findTemplateBySlug === 'function') return repo.findTemplateBySlug;

  // Default export variants
  if (repo.default && typeof repo.default.getTemplateBySlug === 'function')
    return repo.default.getTemplateBySlug;
  if (repo.default && typeof repo.default.selectTemplateBySlug === 'function')
    return repo.default.selectTemplateBySlug;
  if (repo.default && typeof repo.default.findTemplateBySlug === 'function')
    return repo.default.findTemplateBySlug;

  return null;
}

function toStr(v) {
  return v == null ? '' : String(v);
}

function normalizeTemplate(raw, slugFromUrl) {
  const meta = raw?.meta || raw?.metadata || raw?.data || raw || {};

  const slug = toStr(raw?.slug || raw?.id || meta?.slug || slugFromUrl).trim();
  const title =
    toStr(raw?.title).trim() ||
    toStr(raw?.name).trim() ||
    toStr(meta?.title).trim() ||
    toStr(meta?.name).trim() ||
    slug;

  // Preview
  const previewUrl =
    toStr(raw?.previewUrl).trim() ||
    toStr(meta?.previewUrl).trim() ||
    toStr(meta?.preview).trim() ||
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

  return {
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
  };
}

export function createTemplatesRouter() {
  const router = Router();
  const selectCatalog = pickCatalogFn();
  const getBySlug = pickBySlugFn();

  // /templates — catalog
  router.get('/', async (req, res, next) => {
    try {
      const db = req.app.locals?.db;
      const templates = await (selectCatalog.length >= 1 ? selectCatalog(db) : selectCatalog());

      res.render('pages/templates/index', {
        title: 'Templates — Tempasi',
        bodyClass: 'templates-page',
        activePage: 'templates',
        styles: ['/css/pages/catalog.css', '/css/pages/templates.css'],
        templates,
      });
    } catch (err) {
      next(err);
    }
  });

  // /templates/:slug — details page
  router.get('/:slug', async (req, res, next) => {
    try {
      const slug = toStr(req.params.slug).trim();
      const db = req.app.locals?.db;

      let raw = null;

      // Prefer direct repo function if present
      if (getBySlug) {
        raw = await (getBySlug.length >= 2 ? getBySlug(db, slug) : getBySlug(slug));
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

      const template = normalizeTemplate(raw, slug);

      return res.status(200).render('pages/template-details', {
        title: `${template.title} — Tempasi`,
        bodyClass: 'page-template-details',
        activePage: 'templates',
        styles: ['/css/pages/template-details.css'],
        template,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
