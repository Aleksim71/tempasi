// src/web/routes/cabinet.pages.routes.cjs
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const sellerTemplatesService = require('../../modules/templates/sellerTemplates.service.cjs');
const sellerTemplatesRepo = require('../../modules/templates/sellerTemplates.repo.cjs');
const analyticsService = require('../modules/analytics/analytics.cabinet.service.cjs');
const casesService = require('../../modules/cases/cases.service.cjs');
const rentAssignmentsService = require('../../modules/cases/rentAssignments.service.cjs');
const accountCreditsService = require('../../modules/payments/accountCredits.service.cjs');

const { getPool } = require('../../../scripts/db.pool.cjs');
const { clearSessionCookie } = require('../../middlewares/auth.middleware.cjs');
const CreditLedgerController = require("../../modules/finance/creditLedger.controller.cjs");

function requireAuthPage(req, res, next) {
  if (
    req.userId ||
    (req.user && (req.user.id || req.user.user_id || req.user.userId))
  ) {
    return next();
  }

  return res.redirect('/login');
}

function getUserId(req) {
  return req?.user?.id || req?.user?.user_id || req?.user?.userId || req?.userId || null;
}

function formatMoneyEurFromCents(cents) {
  if (cents === null || cents === undefined) return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
}

function formatDateYMD(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// =========================
// Upload (ZIP) — MVP
// =========================

let UPLOAD_DIR;
const configuredUploadDir = process.env.TEMPLATE_UPLOAD_DIR;

if (configuredUploadDir) {
  UPLOAD_DIR = path.resolve(configuredUploadDir);

  if (!fs.existsSync(UPLOAD_DIR)) {
    throw new Error(
      [
        'TEMPLATE_UPLOAD_DIR_NOT_FOUND:',
        `Path does not exist: ${UPLOAD_DIR}`,
        'If you use sshfs, mount it first (e.g., /mnt/tempasi/templates).',
      ].join('\n'),
    );
  }
} else {
  UPLOAD_DIR = path.join(__dirname, '../../../uploads/templates');
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

console.log('[UPLOAD] TEMPLATE_UPLOAD_DIR =', process.env.TEMPLATE_UPLOAD_DIR || '(not set)');
console.log('[UPLOAD] Using UPLOAD_DIR =', UPLOAD_DIR);

// TEMPASI_MOUNT_POINT_GUARD (2026-08-04)
// fs.existsSync() only proves the directory exists — it says nothing
// about WHETHER it's actually the mounted remote filesystem (e.g. an
// sshfs mount to a physically separate "old laptop as server", used
// deliberately as an isolation boundary for uploaded template
// content) versus a plain local directory that happens to sit at the
// same path because the real mount silently dropped (network blip,
// the remote machine sleeping/rebooting, sshfs not set to
// auto-remount). If that happens, uploads would keep "succeeding"
// but land on the local disk instead — exactly the case this project
// is trying to avoid, and the failure would be invisible unless
// something actively checks for it.
//
// A mounted directory has a different device id (st_dev) than its
// parent directory; a plain subdirectory shares the same device id
// as its parent. This is the same check the `mountpoint` Unix
// command uses under the hood. Checked at UPLOAD TIME (inside
// multer's destination callback below), not just once at server
// boot, since the mount can drop mid-session.
function isMountPoint(dirPath) {
  try {
    const resolved = path.resolve(dirPath);
    const parent = path.dirname(resolved);
    const dirStat = fs.statSync(resolved);
    const parentStat = fs.statSync(parent);
    return dirStat.dev !== parentStat.dev;
  } catch (_e) {
    return false;
  }
}

// Only enforce this for a configured (non-default) upload dir. The
// fallback local uploads/templates/ dir (used when TEMPLATE_UPLOAD_DIR
// isn't set at all) is *meant* to be local — nothing to guard there.
// Only enforce this for a configured (non-default) upload dir, and
// never in tests: integration tests deliberately point
// TEMPLATE_UPLOAD_DIR at a plain local temp directory (see e.g.
// tests/myTemplatesPublishedVisibleInCatalog.integration.test.cjs),
// which is correct there and would otherwise be indistinguishable
// from the exact "silently local" failure this guard exists to
// catch. Jest sets NODE_ENV=test automatically when it isn't already
// set (this project's npm test script doesn't set it explicitly).
const ENFORCE_UPLOAD_DIR_MOUNT_CHECK =
  Boolean(configuredUploadDir) && process.env.NODE_ENV !== 'test';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (ENFORCE_UPLOAD_DIR_MOUNT_CHECK && !isMountPoint(UPLOAD_DIR)) {
      return cb(new Error('TEMPLATE_UPLOAD_DIR_NOT_MOUNTED'));
    }
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}.zip`);
  },
});

const upload = multer({
  storage,
  fileFilter: function (req, file, cb) {
    const name = String(file.originalname || '').toLowerCase();
    const isZipByName = name.endsWith('.zip');
    const isZipByMime =
      file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed';

    if (isZipByMime || isZipByName) return cb(null, true);
    return cb(new Error('ONLY_ZIP_ALLOWED'));
  },
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});


function displayZipName(row) {
  const original = String(row?.zip_original_name || '').trim();
  if (original) return original;

  const stored = String(row?.zip_path || '').trim();
  if (!stored) return 'No ZIP uploaded';

  return stored.split(/[\\/]/).filter(Boolean).pop() || stored;
}

function inferSellingOptionFromRow(row) {
  const rentCents = Number(row?.price_rent_cents || 0);
  return rentCents > 0 ? 'buy_rent' : 'buy_only';
}


// TEMPASI_CATALOG_CATEGORIES_FROM_DB (2026-07-20)
// Categories used to be a hardcoded Set duplicated across this file and
// two <select> blocks in space-my-templates.hbs. They are now managed by
// the admin (Settings > Catalog, catalog_categories table) so both the
// dropdown options AND this validation must read from the DB, not a
// static list — otherwise an admin-added category would show up in the
// dropdown but silently get rejected back to 'other' on save.
const FALLBACK_CATEGORY_OPTIONS = [
  { slug: 'other', label: 'Other' },
];

async function getCatalogCategoryOptions(pool) {
  try {
    const { rows } = await pool.query(
      'SELECT slug, label FROM catalog_categories ORDER BY label ASC',
    );
    return rows.length ? rows : FALLBACK_CATEGORY_OPTIONS;
  } catch (e) {
    // catalog_categories missing (e.g. migration not applied yet) —
    // degrade gracefully instead of breaking template add/edit entirely.
    console.error('[cabinet] failed to load catalog_categories, falling back:', e.message);
    return FALLBACK_CATEGORY_OPTIONS;
  }
}

function normalizeTemplateCategoryForRoute(value, allowedSlugs) {
  const category = String(value || '').trim().toLowerCase();
  const allowed = allowedSlugs instanceof Set ? allowedSlugs : new Set(['other']);
  return allowed.has(category) ? category : 'other';
}

function normalizeTemplateTagsForRoute(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const seen = new Set();

  return raw
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .map((tag) => tag.replace(/\s+/g, ' '))
    .filter((tag) => tag.length <= 30)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 15)
    .join(', ');
}



function createCabinetPagesRouter() {
  const router = express.Router();

  router.use((req, res, next) => {
    res.locals.isCabinet = true;
    res.locals.activePage = 'cabinet';
    res.locals.metrics = {
      today: { revenue: 0, invested: 0 },
    };
    next();
  });


  // Public, tokenized client preview. Keep this route before requireAuthPage.
  router.get('/cases/:id/preview/public', async (req, res) => {
    const pool = getPool();
    const caseId = String(req.params.id || '').trim();
    const token = String(req.query.token || '').trim();

    let workspaceError = null;
    let selectedCase = null;
    let templates = [];

    try {
      selectedCase = await casesService.getPublicPreviewCase(caseId, token, pool);

      if (!selectedCase) {
        return res.status(404).render('pages/case-preview-public', {
          styles: ['/css/pages/cabinet.css'],
          bodyClass: 'case-public-preview',
          pageTitle: 'Case Preview Not Found',
          pageSubtitle: 'This public preview link is missing, expired, or invalid.',
          workspaceError: null,
          workspaceData: {
            cases: {
              selectedCase: null,
              templates: [],
              isNotFound: true,
            },
          },
        });
      }

      const rows = await casesService.listPublicPreviewTemplates(caseId, token, pool);
      templates = (rows || []).map(normalizeCaseTemplateRow);
    } catch (err) {
      console.error('[cabinet] public cases/:id/preview error:', err);
      workspaceError = err;
    }

    return res.render('pages/case-preview-public', {
      styles: ['/css/pages/cabinet.css'],
      bodyClass: 'case-public-preview',
      pageTitle: selectedCase ? `${selectedCase.title} — Case Preview` : 'Case Preview',
      pageSubtitle: 'Selected website concepts for client review.',
      workspaceError,
      workspaceData: {
        cases: {
          selectedCase,
          templates,
        },
      },
    });
  });

  router.use(requireAuthPage);

  router.get('/', (req, res) => res.redirect('/cabinet/my-templates'));

  // =========================
  // My Templates
  // =========================

  router.get('/my-templates', async (req, res) => {
    const pool = getPool();
    let workspaceError = null;
    let items = [];
    const categoryOptions = await getCatalogCategoryOptions(pool);

    try {
      const rows = await sellerTemplatesService.listMyTemplates({ pool, user: req.user });

      items = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        status: r.status,
        is_published: r.status === 'published',
        is_admin_blocked: Boolean(r.admin_blocked_at),
        is_sold: Number(r.sold_count || 0) > 0,
        sold_at: r.sold_at || null,
        sold_at_str: r.sold_at ? formatDateYMD(r.sold_at) : '',
        price_buy_eur:
          r.price_buy_cents !== null && r.price_buy_cents !== undefined
            ? formatMoneyEurFromCents(r.price_buy_cents)
            : '',
        price_rent_eur:
          r.price_rent_cents !== null && r.price_rent_cents !== undefined
            ? formatMoneyEurFromCents(r.price_rent_cents)
            : '',
        updated_ts: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
      }));
    } catch (e) {
      workspaceError = e;
    }

    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesList: true,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: false,

      workspaceData: { items },
      workspaceError,
      categoryOptions,
      form: { category: 'other' },

      pageTitle: 'My Templates',
      pageSubtitle: 'Your templates for sale and rent.',
      panelTitle: 'My Templates',
      panelText: '',
    });
  });

  router.get('/my-templates/add', async (req, res) => {
    const pool = getPool();
    const categoryOptions = await getCatalogCategoryOptions(pool);

    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesList: false,
      isMyTemplatesAdd: true,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: false,

      workspaceData: { items: [] },
      workspaceError: null,
      categoryOptions,

      form: { title: '', shortDescription: '', category: 'other', tags: '', priceBuy: '', priceRent: '', sellingOption: 'buy_rent', status: 'draft' },
      formErrors: {},
      formIsDraft: true,
      formIsPublished: false,

      pageTitle: 'Add Template',
      pageSubtitle: 'Create a template record. Slug is generated automatically by the system.',
      panelTitle: 'Add Template',
      panelText: '',
    });
  });

  router.post('/my-templates/add', upload.single('templateZip'), async (req, res) => {
    const pool = getPool();

    const form = {
      title: String(req.body?.title || ''),
      shortDescription: String(req.body?.shortDescription || ''),
      category: String(req.body?.category || 'other'),
      tags: String(req.body?.tags || ''),
      priceBuy: String(req.body?.priceBuy || ''),
      priceRent: String(req.body?.priceRent || ''),
      sellingOption: String(req.body?.sellingOption || req.body?.license || 'buy_rent'),
      status: String(req.body?.status || 'draft'),
    };

    let workspaceError = null;
    let formErrors = {};

    try {
      const file = req.file;
      if (!file) {
        formErrors.templateZip = 'ZIP file is required.';
        throw new Error('ZIP_REQUIRED');
      }

      await sellerTemplatesService.addSellerTemplate({
        pool,
        user: req.user,
        body: req.body,
        file,
      });

      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      if (e && e.message === 'TEMPLATE_UPLOAD_DIR_NOT_MOUNTED') {
        formErrors.templateZip =
          'Upload storage is not connected right now (the storage machine appears to be off or unreachable). Turn it on and try again.';
      } else if (e && e.message === 'ONLY_ZIP_ALLOWED') {
        formErrors.templateZip = 'Only .zip files are allowed.';
      } else if (e && e.code === 'LIMIT_FILE_SIZE') {
        formErrors.templateZip = 'ZIP is too large (max 50MB).';
      } else if (e && e.message === 'ZIP_REQUIRED') {
      } else if (e && e.code === 'VALIDATION_FAILED' && e.details && e.details.errors) {
        formErrors = { ...formErrors, ...e.details.errors };
      } else if (e && (e.code === 'SLUG_TAKEN' || e.message === 'SLUG_TAKEN')) {
        formErrors.slug = 'This slug is already used. Choose another one.';
      } else if (e && (e.code === 'SLUG_ALREADY_EXISTS' || e.message === 'SLUG_ALREADY_EXISTS')) {
        // TEMPASI_SLUG_COLLISION_RETRY_FIX (2026-08-12): addSellerTemplate
        // already retries a few times on this exact error internally —
        // reaching here means every retry still collided, which should be
        // rare. Give a clear, actionable message instead of falling
        // through to the generic workspaceError banner.
        workspaceError = new Error(
          'A template with that name was just created a moment ago (likely a duplicate submission). Try Add again, or change the title slightly.',
        );
      } else {
        workspaceError = e;
      }
    }

    const status = String(req.body?.status || 'draft');
    // TEMPASI_ADD_TEMPLATE_CATEGORY_OPTIONS_FIX (2026-08-12): the GET
    // handler above passes categoryOptions to populate the <select>,
    // but this error-path re-render (e.g. "ZIP file is required")
    // never did — {{#each categoryOptions}} rendered zero <option>
    // elements, making the category dropdown look empty/reset even
    // though form.category (and the view's `selected` logic) were
    // both actually fine.
    const categoryOptions = await getCatalogCategoryOptions(pool);
    return res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesList: false,
      isMyTemplatesAdd: true,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: false,

      workspaceData: { items: [] },
      workspaceError,
      categoryOptions,

      form,
      formErrors,
      formIsDraft: status === 'draft',
      formIsPublished: status === 'published',
      formIsBuyOnly: String(form.sellingOption || 'buy_rent') === 'buy_only',
      formIsBuyRent: String(form.sellingOption || '') === 'buy_rent',

      pageTitle: 'Add Template',
      pageSubtitle: 'Create a template record. Slug is generated automatically by the system.',
      panelTitle: 'Add Template',
      panelText: '',
    });
  });

  router.post('/my-templates/:id/status', express.urlencoded({ extended: false }), async (req, res) => {
    const pool = getPool();
    try {
      const id = Number(req.params.id);
      const nextStatus = String(req.body?.status || '').trim();
      await sellerTemplatesService.updateMyTemplateStatus({
        pool,
        user: req.user,
        id,
        status: nextStatus,
      });
    } catch (e) {
      console.error('[cabinet] my-templates/:id/status error:', e);
    }
    return res.redirect('/cabinet/my-templates');
  });

  // TEMPASI_MY_TEMPLATES_DELETE_ROUTE (2026-08-11): the "Delete" button
  // in space-my-templates.hbs has always posted to this exact path, and
  // sellerTemplatesService.deleteMyTemplate() (soft-delete + zip/preview
  // file cleanup) was already fully built — this route just wasn't
  // wired up, so every delete attempt hit Express's default 404
  // ("Cannot POST ...").
  router.post('/my-templates/:id/delete', express.urlencoded({ extended: false }), async (req, res) => {
    const pool = getPool();
    try {
      const id = Number(req.params.id);
      await sellerTemplatesService.deleteMyTemplate({
        pool,
        user: req.user,
        id,
      });
    } catch (e) {
      console.error('[cabinet] my-templates/:id/delete error:', e);
    }
    return res.redirect('/cabinet/my-templates');
  });

  router.get('/my-templates/:id/edit', async (req, res) => {
    const pool = getPool();
    const id = Number(req.params.id);
    const categoryOptions = await getCatalogCategoryOptions(pool);
    const allowedSlugs = new Set(categoryOptions.map((c) => c.slug));

    let row = null;
    let workspaceError = null;

    try {
      row = await sellerTemplatesRepo.getSellerTemplateForOwnerById({
        pool,
        ownerUserId: getUserId(req),
        id,
      });
    } catch (e) {
      workspaceError = e;
    }

    if (!row && !workspaceError) {
      workspaceError = new Error('Template not found');
    }

    
    // TEMPASI_EDIT_GET_CATEGORY_TAGS_META_FETCH_CURRENT
    // Force-load saved catalog metadata for the edit form from DB.
    let editCategory = normalizeTemplateCategoryForRoute(row?.category || 'other', allowedSlugs);
    let editTags = String(row?.tags || '');

    if (row && row.id) {
      const metaResult = await pool.query(
        `
          SELECT category, tags
          FROM seller_templates
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [row.id],
      );

      const meta = metaResult.rows[0] || {};
      editCategory = normalizeTemplateCategoryForRoute(meta.category || row.category || 'other', allowedSlugs);
      editTags = String(meta.tags || row.tags || '');
    }

res.render('pages/cabinet', {
      activeSpace: 'my-templates',
      isMyTemplatesList: false,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: true,
      workspaceData: { items: [] },
      workspaceError,
      categoryOptions,
      form: row
        ? {
            title: row.title || '',
            slug: row.slug || '',
            shortDescription: row.short_description || '',
            category: editCategory,
            tags: editTags,
            priceBuy:
              row.price_buy_cents !== null && row.price_buy_cents !== undefined
                ? formatMoneyEurFromCents(row.price_buy_cents)
                : '',
            priceRent:
              row.price_rent_cents !== null && row.price_rent_cents !== undefined
                ? formatMoneyEurFromCents(row.price_rent_cents)
                : '',
            sellingOption: inferSellingOptionFromRow(row),
            status: row.status || 'draft',
            currentZipName: displayZipName(row),
          }
        : { title: '', shortDescription: '', category: editCategory, tags: editTags, priceBuy: '', priceRent: '', sellingOption: 'buy_rent', status: 'draft', currentZipName: 'No ZIP uploaded' },
      formErrors: {},
      formIsDraft: row ? row.status === 'draft' : true,
      formIsPublished: row ? row.status === 'published' : false,
      formIsBuyOnly: row ? inferSellingOptionFromRow(row) === 'buy_only' : false,
      formIsBuyRent: row ? inferSellingOptionFromRow(row) === 'buy_rent' : true,
      pageTitle: 'Edit Template',
      pageSubtitle: 'Update template details.',
      panelTitle: 'Edit Template',
      panelText: '',
      editId: id,
    });
  });

  router.post('/my-templates/:id/edit', upload.single('templateZip'), async (req, res) => {
    const pool = getPool();
    const id = Number(req.params.id);
    const categoryOptions = await getCatalogCategoryOptions(pool);
    const allowedSlugs = new Set(categoryOptions.map((c) => c.slug));

    const form = {
      title: String(req.body?.title || ''),
      shortDescription: String(req.body?.shortDescription || ''),
      category: String(req.body?.category || 'other'),
      tags: String(req.body?.tags || ''),
      priceBuy: String(req.body?.priceBuy || ''),
      priceRent: String(req.body?.priceRent || ''),
      sellingOption: String(req.body?.sellingOption || req.body?.license || 'buy_rent'),
      status: String(req.body?.status || 'draft'),
    };

    let workspaceError = null;
    let formErrors = {};

    try {
      await sellerTemplatesService.updateSellerTemplate({
        pool,
        user: req.user,
        id,
        body: req.body,
        file: req.file || null,
      });

  
    // TEMPASI_FORCE_SAVE_CATEGORY_TAGS_FROM_EDIT_ROUTE
    // Category and tags are catalog metadata from the edit form.
    // Persist them here explicitly so they cannot be lost in older repo/service update paths.
    try {
      const ownerUserId =
        req.user?.id ||
        req.user?.user_id ||
        req.user?.userId ||
        req.session?.user?.id ||
        req.session?.userId ||
        null;

      if (ownerUserId) {
        await pool.query(
          `
            UPDATE seller_templates
            SET
              category = $1,
              tags = $2,
              updated_at = NOW()
            WHERE id = $3
              AND owner_user_id = $4
              AND deleted_at IS NULL
          `,
          [
            normalizeTemplateCategoryForRoute(req.body?.category, allowedSlugs),
            normalizeTemplateTagsForRoute(req.body?.tags),
            id,
            ownerUserId,
          ],
        );
      }
    } catch (metaError) {
      console.error('[cabinet] failed to persist template category/tags:', metaError);
    }

    return res.redirect('/cabinet/my-templates');
    } catch (e) {
      if (e && e.message === 'TEMPLATE_UPLOAD_DIR_NOT_MOUNTED') {
        formErrors.templateZip =
          'Upload storage is not connected right now (the storage machine appears to be off or unreachable). Turn it on and try again.';
      } else if (e && e.message === 'ONLY_ZIP_ALLOWED') {
        formErrors.templateZip = 'Only .zip files are allowed.';
      } else if (e && e.code === 'LIMIT_FILE_SIZE') {
        formErrors.templateZip = 'ZIP is too large (max 50MB).';
      } else if (e && e.code === 'VALIDATION_FAILED' && e.details && e.details.errors) {
        formErrors = { ...formErrors, ...e.details.errors };
      } else if (e && (e.code === 'SLUG_TAKEN' || e.message === 'SLUG_TAKEN')) {
        formErrors.slug = 'This slug is already used. Choose another one.';
      } else {
        workspaceError = e;
      }
    }

    const status = String(req.body?.status || 'draft');
    return res.render('pages/cabinet', {
      activeSpace: 'my-templates',
      isMyTemplatesList: false,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: true,
      workspaceData: { items: [] },
      workspaceError,
      categoryOptions,
      form,
      formErrors,
      formIsDraft: status === 'draft',
      formIsPublished: status === 'published',
      formIsBuyOnly: String(form.sellingOption || 'buy_rent') === 'buy_only',
      formIsBuyRent: String(form.sellingOption || '') === 'buy_rent',
      pageTitle: 'Edit Template',
      pageSubtitle: 'Update template details.',
      panelTitle: 'Edit Template',
      panelText: '',
      editId: id,
    });
  });

  router.get('/my-templates/analytics', async (req, res) => {
    const requestedTab = String(req.query.tab || '').trim();
    const allowedTabs = new Set(['overview', 'table', 'advanced']);
    const tab = allowedTabs.has(requestedTab) ? requestedTab : 'overview';

    const sort = String(req.query.sort || 'total_revenue').trim();
    const dir = String(req.query.dir || 'desc').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

    const ownerUserId = getUserId(req);
    let workspaceError = null;

    const empty = {
      analytics: {
        tab,
        sort,
        dir,
        summary: {
          templatesCount: 0,
          publishedCount: 0,
          soldTemplatesCount: 0,
          buyOrdersCount: 0,
          rentOrdersCount: 0,
          revenueBuyEur: '0.00',
          revenueRentEur: '0.00',
          revenueTotalEur: '0.00',
        },
        topTemplates: [],
        monthlyRevenue: [],
        columns: [
          { key: 'title', label: 'Template', sortable: false },
          { key: 'created_at', label: 'Created', sortable: true },
          { key: 'first_order_at', label: 'First order', sortable: true },
          { key: 'last_order_at', label: 'Last order', sortable: true },
          { key: 'rent_count', label: 'Rents', sortable: true },
          { key: 'rent_revenue', label: 'Rent revenue', sortable: true },
          { key: 'buy_revenue', label: 'Buy revenue', sortable: true },
          { key: 'sold_at', label: 'Sold at', sortable: true },
          { key: 'total_revenue', label: 'Total revenue', sortable: true },
        ],
      },
    };

    let analyticsPayload = empty.analytics;

    try {
      const analytics = await analyticsService.getCabinetAnalytics({
        ownerUserId,
        months: 6,
        sort,
        dir,
      });

      analyticsPayload = {
        tab,
        sort,
        dir,
        summary: analytics.summary || empty.analytics.summary,
        topTemplates: analytics.topTemplates || [],
        monthlyRevenue: analytics.monthlyRevenue || [],
        columns: empty.analytics.columns,
      };
    } catch (e) {
      workspaceError = e;
    }

    res.render('pages/cabinet', {
      activeSpace: 'my-templates',
      isMyTemplatesList: false,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: true,
      isMyTemplatesEdit: false,
      workspaceData: {
        analytics: analyticsPayload,
      },
      workspaceError,
      pageTitle: 'Analytics',
      pageSubtitle: 'Performance of your templates.',
      panelTitle: 'Analytics',
      panelText: '',
    });
  });

  router.get('/cases', async (req, res) => {
    const requestedTab = String(req.query.tab || '').trim();
    const allowedTabs = new Set(['list', 'create', 'rents', 'analytics']);
    const tab = allowedTabs.has(requestedTab) ? requestedTab : 'list';

    const pool = getPool();
    const userId = getUserId(req);

    let workspaceError = null;

    let caseItems = [];

    let rents = [];
    let analytics = {
      activeCases: 2,
      heldTemplates: 0,
      activeRentCostEur: '0.00',
    };

    try {
      await casesService.ensureDefaultCaseForUser(userId, pool);

      const ownerCases = await casesService.getOwnerCases(userId, pool);
      caseItems = (ownerCases || []).map((item) => ({
        id: item.id,
        title: item.title,
        clientName: item.client_name || '',
        status: 'open',
        templatesCount: Number(item.templates_count || 0),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        publicPreviewToken: item.public_preview_token || '',
        publicPreviewUrl: item.public_preview_token
          ? `/cabinet/cases/${encodeURIComponent(item.id)}/preview/public?token=${encodeURIComponent(item.public_preview_token)}`
          : '',
      }));

      const rentsResult = await pool.query(
        `
          SELECT
            e.id,
            e.order_id,
            e.template_slug,
            e.starts_at,
            e.ends_at,
            e.created_at,
            o.amount_cents,
            o.currency,
            COALESCE(st.title, e.template_slug) AS template_title,
            COUNT(oca.case_id)::int AS cases_count
          FROM public.entitlements e
          LEFT JOIN public.orders o
            ON o.id = e.order_id
          LEFT JOIN public.seller_templates st
            ON st.slug = e.template_slug
          LEFT JOIN public.order_case_assignments oca
            ON oca.order_id = e.order_id
          WHERE e.user_id = $1
            AND UPPER(COALESCE(e.deal_type, e.kind, '')) = 'RENT'
            AND e.closed_at IS NULL
            AND (e.ends_at IS NULL OR e.ends_at > NOW())
          GROUP BY e.id, o.id, st.title
          ORDER BY e.ends_at ASC NULLS LAST, e.created_at DESC, e.id DESC
        `,
        [userId],
      );

      let activeRentCostCents = 0;

      const caseTitleById = new Map(caseItems.map((item) => [String(item.id), item.title]));

      rents = [];
      for (const row of rentsResult.rows || []) {
        const assignedIds = await rentAssignmentsService.listAssignments(row.order_id, pool);
        const assignedSet = new Set(assignedIds.map(String));
        const assignedCases = assignedIds.map((caseId) => ({
          id: caseId,
          title: caseTitleById.get(String(caseId)) || `Case ${caseId}`,
        }));
        const availableCases = caseItems
          .filter((item) => !assignedSet.has(String(item.id)))
          .map((item) => ({ id: item.id, title: item.title }));

        rents.push(normalizeCaseRentRow({
          ...row,
          assignedCases,
          availableCases,
          cases_count: assignedCases.length,
          canRemoveAssignments: assignedCases.length > 1,
          lastAssignmentMessage: rentAssignmentsService.LAST_RENT_CASE_ASSIGNMENT_MESSAGE,
        }));
      }

      analytics = {
        activeCases: caseItems.length,
        heldTemplates: rents.length,
        activeRentCostEur: formatMoneyEurFromCents(activeRentCostCents),
      };
    } catch (e) {
      workspaceError = e;
    }

    res.render('pages/cabinet', {
      activeSpace: 'cases',
      pageTitle: '',
      pageSubtitle: '',
      panelTitle: 'Cases',
      panelText: '',
      workspaceError,
      workspaceData: {
        cases: {
          tab,
          tabs: getCaseTabs(tab),
          items: caseItems,
          lastCaseDeleteMessage: casesService.LAST_CASE_DELETE_MESSAGE,
          rents,
          analytics,
        },
      },
    });
  });


  router.get('/cases/:id', async (req, res) => {
    const pool = getPool();
    const userId = getUserId(req);
    const caseId = String(req.params.id || '').trim();

    let workspaceError = null;
    let selectedCase = null;
    let templates = [];

    try {
      selectedCase = await casesService.getOwnedCase(userId, caseId, pool);

      if (!selectedCase) {
        return res.redirect('/cabinet/cases?tab=list&error=case_not_found');
      }

      selectedCase.publicPreviewUrl = selectedCase.public_preview_token
        ? `/cabinet/cases/${encodeURIComponent(selectedCase.id)}/preview/public?token=${encodeURIComponent(selectedCase.public_preview_token)}`
        : '';

      const rows = await casesService.listCaseTemplates(userId, caseId, pool);
      templates = (rows || []).map(normalizeCaseTemplateRow);

      for (const item of templates) {
        const availableCases = await casesService.listAvailableCasesForOrder(userId, item.orderId, pool);
        item.availableCases = (availableCases || []).map((row) => ({
          id: row.id,
          title: row.title || `Case ${row.id}`,
        }));
      }
    } catch (err) {
      console.error('[cabinet] cases/:id view error:', err);
      workspaceError = err;
    }

    return res.render('pages/cabinet', {
      activeSpace: 'cases',
      pageTitle: '',
      pageSubtitle: '',
      panelTitle: 'Case View',
      panelText: '',
      workspaceError,
      workspaceData: {
        cases: {
          tab: 'view',
          tabs: getCaseTabs(''),
          selectedCase,
          templates,
        },
      },
    });
  });

  router.get('/cases/:id/preview', async (req, res) => {
    const pool = getPool();
    const userId = getUserId(req);
    const caseId = String(req.params.id || '').trim();

    let workspaceError = null;
    let selectedCase = null;
    let templates = [];

    try {
      selectedCase = await casesService.getOwnedCase(userId, caseId, pool);

      if (!selectedCase) {
        return res.redirect('/cabinet/cases?tab=list&error=case_not_found');
      }

      selectedCase.publicPreviewUrl = selectedCase.public_preview_token
        ? `/cabinet/cases/${encodeURIComponent(selectedCase.id)}/preview/public?token=${encodeURIComponent(selectedCase.public_preview_token)}`
        : '';

      const rows = await casesService.listCaseTemplates(userId, caseId, pool);
      templates = (rows || []).map(normalizeCaseTemplateRow);
    } catch (err) {
      console.error('[cabinet] cases/:id/preview error:', err);
      workspaceError = err;
    }

    return res.render('pages/cabinet', {
      activeSpace: 'cases',
      pageTitle: 'Case Preview',
      pageSubtitle: 'Presentation preview for the selected client case.',
      panelTitle: 'Case Preview',
      panelText: '',
      workspaceError,
      workspaceData: {
        cases: {
          tab: 'preview',
          tabs: getCaseTabs(''),
          selectedCase,
          templates,
        },
      },
    });
  });

  router.post('/cases/:id/clear', express.urlencoded({ extended: false }), async (req, res) => {
    const pool = getPool();
    const userId = getUserId(req);
    const caseId = String(req.params.id || '').trim();

    try {
      await casesService.clearCase(userId, caseId, pool);
      return res.redirect('/cabinet/cases?tab=list');
    } catch (err) {
      console.error('[cabinet] cases/:id/clear error:', err);
      return res.redirect('/cabinet/cases?tab=list&error=case_clear_failed');
    }
  });

  router.post('/cases/:caseId/templates/:orderId/exclude', express.urlencoded({ extended: false }), async (req, res) => {
    const pool = getPool();
    const userId = getUserId(req);
    const caseId = String(req.params.caseId || '').trim();
    const orderId = Number(req.params.orderId);

    try {
      await rentAssignmentsService.removeAssignment({ userId, orderId, caseId }, pool);
      return res.redirect(`/cabinet/cases/${encodeURIComponent(caseId)}`);
    } catch (err) {
      console.error('[cabinet] cases/:caseId/templates/:orderId/exclude error:', err);
      const code = err && err.code ? String(err.code) : 'template_exclude_failed';
      return res.redirect(`/cabinet/cases/${encodeURIComponent(caseId)}?error=${encodeURIComponent(code)}`);
    }
  });

  router.post('/cases/:caseId/templates/:orderId/copy', express.urlencoded({ extended: false }), async (req, res) => {
    const pool = getPool();
    const userId = getUserId(req);
    const currentCaseId = String(req.params.caseId || '').trim();
    const orderId = Number(req.params.orderId);
    const targetCaseId = String(req.body?.caseId || req.body?.case_id || '').trim();

    try {
      await rentAssignmentsService.addAssignment({ userId, orderId, caseId: targetCaseId }, pool);
      return res.redirect(`/cabinet/cases/${encodeURIComponent(currentCaseId)}`);
    } catch (err) {
      console.error('[cabinet] cases/:caseId/templates/:orderId/copy error:', err);
      const code = err && err.code ? String(err.code) : 'template_copy_failed';
      return res.redirect(`/cabinet/cases/${encodeURIComponent(currentCaseId)}?error=${encodeURIComponent(code)}`);
    }
  });


  router.post('/cases', express.urlencoded({ extended: false }), async (req, res, next) => {
    try {
      const pool = getPool();
      const userId = getUserId(req);
      const title = String(req.body?.title || '').trim() || 'New client case';
      const clientName = String(req.body?.clientName || '').trim();

      await casesService.create(
        userId,
        {
          title,
          clientName,
          note: '',
        },
        pool
      );

      return res.redirect('/cabinet/cases?tab=list');
    } catch (err) {
      return next(err);
    }
  });

  router.post('/cases/:id/delete', express.urlencoded({ extended: false }), async (req, res) => {
    const pool = getPool();
    const userId = getUserId(req);
    const caseId = String(req.params.id || '').trim();

    try {
      await casesService.deleteCase(userId, caseId, pool);
      return res.redirect('/cabinet/cases?tab=list');
    } catch (err) {
      if (err && err.code === 'LAST_CASE_DELETE_BLOCKED') {
        return res.redirect(
          '/cabinet/cases?tab=list&error=last_case_delete_blocked'
        );
      }

      console.error('[cabinet] cases/:id/delete error:', err);
      return res.redirect('/cabinet/cases?tab=list&error=case_delete_failed');
    }
  });

  router.post('/cases/rents/:orderId/assign', express.urlencoded({ extended: false }), async (req, res) => {
    const pool = getPool();
    const userId = getUserId(req);
    const orderId = Number(req.params.orderId);
    const caseId = String(req.body?.caseId || req.body?.case_id || '').trim();

    try {
      await rentAssignmentsService.addAssignment({ userId, orderId, caseId }, pool);
      return res.redirect('/cabinet/cases?tab=rents');
    } catch (err) {
      console.error('[cabinet] cases/rents/:orderId/assign error:', err);
      const code = err && err.code ? String(err.code) : 'rent_assignment_failed';
      return res.redirect(`/cabinet/cases?tab=rents&error=${encodeURIComponent(code)}`);
    }
  });

  router.post('/cases/rents/:orderId/remove-case', express.urlencoded({ extended: false }), async (req, res) => {
    const pool = getPool();
    const userId = getUserId(req);
    const orderId = Number(req.params.orderId);
    const caseId = String(req.body?.caseId || req.body?.case_id || '').trim();

    try {
      await rentAssignmentsService.removeAssignment({ userId, orderId, caseId }, pool);
      return res.redirect('/cabinet/cases?tab=rents');
    } catch (err) {
      console.error('[cabinet] cases/rents/:orderId/remove-case error:', err);
      const code = err && err.code ? String(err.code) : 'rent_assignment_remove_failed';
      return res.redirect(`/cabinet/cases?tab=rents&error=${encodeURIComponent(code)}`);
    }
  });

  router.get('/finance/credit-ledger/export.csv', requireAuthPage, CreditLedgerController.handleCreditLedgerCsv);
  router.get('/finance/credit-ledger', requireAuthPage, CreditLedgerController.handleCreditLedger);

  router.get('/finance', async (req, res) => {
    const requestedTab = String(req.query.tab || '').trim();
    const allowedTabs = new Set(['overview', 'orders', 'reports']);
    const tab = allowedTabs.has(requestedTab) ? requestedTab : 'overview';

    const pool = getPool();
    let workspaceError = null;
    let overview = {
      totalOrders: 0,
      buyOrders: 0,
      rentOrders: 0,
      ownRevenueEur: '0.00',
      procurementEur: '0.00',
      creditBalanceEur: '0.00',
    };
    let orders = [];
    let reports = [
      {
        month: 'Current',
        totalOrders: 0,
        buyOrders: 0,
        rentOrders: 0,
        ownRevenueEur: '0.00',
        procurementEur: '0.00',
      },
    ];

    try {
      const userId = getUserId(req);

      const { rows } = await pool.query(
        `
          SELECT
            o.id,
            o.template_slug,
            o.deal_type,
            o.license,
            o.status,
            o.created_at,
            o.amount_cents,
            o.currency,
            COALESCE(t.title, o.template_slug) AS template_title
          FROM orders o
          LEFT JOIN templates t
            ON t.slug = o.template_slug
          WHERE o.user_id = $1
          ORDER BY o.created_at DESC, o.id DESC
        `,
        [userId],
      );

      let buyCount = 0;
      let rentCount = 0;
      let paidBuyTotal = 0;
      let paidRentTotal = 0;

      orders = (rows || []).map((row) => {
        const type = String(row.deal_type || '').toUpperCase();
        const status = String(row.status || '').toLowerCase();
        const cents = Number(row.amount_cents || 0);

        if (type === 'BUY') {
          buyCount += 1;
          if (status === 'paid') paidBuyTotal += cents;
        } else if (type === 'RENT') {
          rentCount += 1;
          if (status === 'paid') paidRentTotal += cents;
        }

        return {
          id: row.id,
          type,
          direction: type === 'BUY' ? 'Procurement' : 'Rent',
          templateTitle: row.template_title || row.template_slug || '',
          seller: '—',
          amountEur: formatMoneyEurFromCents(cents),
          status: row.status || '',
          license: row.license || '—',
          date: formatDateYMD(row.created_at),
          caseTitle: '—',
        };
      });

      const creditBalance = await accountCreditsService.getActiveCreditBalance({ userId });

      overview = {
        totalOrders: buyCount + rentCount,
        buyOrders: buyCount,
        rentOrders: rentCount,
        ownRevenueEur: '0.00',
        procurementEur: formatMoneyEurFromCents(paidBuyTotal + paidRentTotal),
        creditBalanceEur: formatMoneyEurFromCents(creditBalance.amountCents),
      };

      reports = [
        {
          month: 'Current',
          totalOrders: overview.totalOrders,
          buyOrders: overview.buyOrders,
          rentOrders: overview.rentOrders,
          ownRevenueEur: overview.ownRevenueEur,
          procurementEur: overview.procurementEur,
        },
      ];
    } catch (e) {
      workspaceError = e;
    }

    res.render('pages/cabinet', {
      activeSpace: 'finance',
      pageTitle: 'Finance',
      pageSubtitle: 'Your orders, payments and downloads.',
      panelTitle: 'Finance',
      panelText: '',
      workspaceError,
      workspaceData: {
        finance: {
          tab,
          tabs: [
            { key: 'overview', label: 'Overview', href: '/cabinet/finance?tab=overview', isActive: tab === 'overview' },
            { key: 'orders', label: 'Orders', href: '/cabinet/finance?tab=orders', isActive: tab === 'orders' },
            { key: 'reports', label: 'Reports', href: '/cabinet/finance?tab=reports', isActive: tab === 'reports' },
          ],
          overview,
          orders,
          reports,
        },
      },
    });
  });

  router.get('/profile', async (req, res) => {
    const requestedTab = String(req.query.tab || '').trim();
    const allowedTabs = new Set(['profile', 'security']);
    const tab = allowedTabs.has(requestedTab) ? requestedTab : 'profile';

    const pool = getPool();
    const userId = getUserId(req);

    let profileRow = null;
    let downloads = [];
    let workspaceError = null;

    try {
      const profileResult = await pool.query(
        `
          SELECT
            user_id,
            full_name,
            nickname,
            about,
            avatar_url,
            public_email,
            website_url,
            public_profile,
            updated_at
          FROM user_profiles
          WHERE user_id = $1
          LIMIT 1
        `,
        [userId],
      );

      profileRow = profileResult.rows[0] || null;

      const downloadsResult = await pool.query(
        `
          SELECT
            e.template_slug,
            e.created_at,
            o.license,
            COALESCE(t.title, e.template_slug) AS template_title
          FROM entitlements e
          LEFT JOIN orders o
            ON o.id = e.order_id
          LEFT JOIN templates t
            ON t.slug = e.template_slug
          WHERE e.user_id = $1
            AND UPPER(COALESCE(e.deal_type, 'BUY')) = 'BUY'
          ORDER BY e.created_at DESC, e.id DESC
        `,
        [userId],
      );

      downloads = (downloadsResult.rows || []).map((row) => ({
        template_slug: row.template_slug || '',
        template_title: row.template_title || row.template_slug || '',
        license: row.license || '—',
        created_at_str: formatDateYMD(row.created_at),
        download_href: `/downloads/${encodeURIComponent(row.template_slug || '')}`,
      }));
    } catch (e) {
      workspaceError = e;
    }

    res.render('pages/cabinet', {
      activeSpace: 'profile',
      pageTitle: 'Profile & Security',
      pageSubtitle: 'Account settings and security.',
      panelTitle: 'Profile',
      panelText: '',
      workspaceError,
      workspaceData: {
        profile: {
          tab,
          tabs: [
            { key: 'profile', label: 'Profile', href: '/cabinet/profile?tab=profile', isActive: tab === 'profile' },
            { key: 'security', label: 'Security', href: '/cabinet/profile?tab=security', isActive: tab === 'security' },
          ],
          form: {
            full_name: profileRow?.full_name || '',
            nickname: profileRow?.nickname || '',
            about: profileRow?.about || '',
            public_email: profileRow?.public_email || '',
            email: req?.user?.email || '',
            avatarUrl: profileRow?.avatar_url || '',
            publicProfile: Boolean(profileRow?.public_profile),
          },
          downloads,
        },
      },
    });
  });

  router.post('/profile/delete-account', async (req, res, next) => {
    // TEMPASI_ACCOUNT_SELF_DELETE (2026-08-16)
    //
    // No physical deletion — sets status='deleted' + self_deleted_at,
    // exactly mirroring the login route's existing (previously
    // dormant) `status !== 'active'` rejection in
    // auth.pages.routes.js. Every place that lists templates/profiles
    // publicly additionally checks the owner's self_deleted_at, so
    // this account's listings disappear without touching a single
    // seller_templates row. Existing buyers keep their
    // entitlements/downloads — this doesn't touch orders/entitlements
    // at all.
    //
    // Revokes ALL sessions for this user (same pattern already used
    // by passwordReset.routes.cjs after a password change), then
    // clears this browser's own cookie and redirects to /login.
    try {
      const userId = getUserId(req);
      if (!userId) return res.redirect(302, '/login');

      const pool = getPool();
      await pool.query(
        `UPDATE users SET status = 'deleted', self_deleted_at = NOW(), updated_at = NOW() WHERE id = $1::bigint`,
        [userId],
      );
      await pool.query(`DELETE FROM sessions WHERE user_id = $1::bigint`, [userId]);

      clearSessionCookie(req, res);

      return res.redirect(302, '/login?account=deleted');
    } catch (err) {
      return next(err);
    }
  });

  router.get('/support', (req, res) => {
    const tab = req.query.tab || 'help';

    const tabs = [
      { key: 'help', label: 'Help', href: '/cabinet/support?tab=help', isActive: tab === 'help' },
      { key: 'contact', label: 'Contact', href: '/cabinet/support?tab=contact', isActive: tab === 'contact' },
      { key: 'quick', label: 'Quick Help', href: '/cabinet/support?tab=quick', isActive: tab === 'quick' },
    ];

    res.render('pages/cabinet', {
      activeSpace: 'support',
      pageTitle: 'Support',
      pageSubtitle: 'Help and documentation.',
      panelTitle: 'Support',
      panelText: '',
      workspaceData: {
        support: {
          tab,
          tabs,
        },
      },
    });
  });

  return router;
}


function formatCaseRentDateTime(value) {
  if (!value) return 'Not set yet';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set yet';

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatCaseRentMoneyEur(value) {
  const number = Number(value || 0);
  return number.toFixed(2);
}

function formatCaseRentTimeLeft(value) {
  if (!value) return 'No deadline';

  const expiresAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return 'No deadline';

  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';

  const totalMinutes = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

function getCaseTabs(activeKey) {
  return [
    { key: 'list', label: 'List', href: '/cabinet/cases?tab=list', isActive: activeKey === 'list' },
    { key: 'create', label: 'Create', href: '/cabinet/cases?tab=create', isActive: activeKey === 'create' },
    { key: 'rents', label: 'Rents', href: '/cabinet/cases?tab=rents', isActive: activeKey === 'rents' },
    { key: 'analytics', label: 'Analytics', href: '/cabinet/cases?tab=analytics', isActive: activeKey === 'analytics' },
  ];
}

function formatCaseTemplateMoneyEur(cents) {
  if (cents === null || cents === undefined || cents === '') return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
}

function resolveCaseTemplatePreviewUrl(row, slug) {
  const normalizedSlug = String(slug || '').trim();
  const direct = String(
    row.preview_url ||
      row.preview_image ||
      row.previewUrl ||
      row.previewPath ||
      row.preview_path ||
      ''
  ).trim();

  if (direct) {
    if (direct.startsWith('/')) return direct;

    const previewFile = direct.match(/preview\.(png|jpg|jpeg|webp|svg)$/i);
    if (normalizedSlug && previewFile) {
      return `/t/${encodeURIComponent(normalizedSlug)}/preview/preview.${previewFile[1].toLowerCase()}`;
    }

    return `/${direct.replace(/^\/+/, '')}`;
  }

  if (normalizedSlug && row.zip_path) {
    return `/t/${encodeURIComponent(normalizedSlug)}/preview/preview.png`;
  }

  return normalizedSlug ? `/t/${encodeURIComponent(normalizedSlug)}/preview/preview.png` : '';
}


function withBackParam(url, backUrl) {
  const target = String(url || '').trim();
  const back = String(backUrl || '').trim();

  if (!target || !back) return target;

  const separator = target.includes('?') ? '&' : '?';
  return `${target}${separator}back=${encodeURIComponent(back)}`;
}

function normalizeCaseTemplateTags(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  if (raw.startsWith('{') && raw.endsWith('}')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((tag) => tag.replace(/^"|"$/g, '').trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeCaseTemplateRow(row) {
  const slug = String(row.template_slug || '').trim();
  const endsAt = row.ends_at || null;
  const casesCount = Number(row.cases_count || 0);
  const buyPriceEur = formatCaseTemplateMoneyEur(row.price_buy_cents);
  const rentPriceEur = formatCaseTemplateMoneyEur(row.price_rent_cents);
  const demoUrl = String(row.demo_url || '').trim();
  const templateDetailsUrl = slug ? `/templates/${encodeURIComponent(slug)}` : '/templates';
  const templateDemoUrl = slug ? `/templates/${encodeURIComponent(slug)}/demo` : demoUrl || '/templates';

  return {
    orderId: row.order_id,
    entitlementId: row.entitlement_id,
    templateId: row.template_id,
    slug,
    title: row.title || slug || 'Untitled template',
    shortDescription: row.short_description || 'No description added yet.',
    description: row.description || row.short_description || '',
    category: row.category || 'other',
    tags: row.tags || '',
    tagItems: normalizeCaseTemplateTags(row.tags),
    templateStatus: row.template_status || '',
    startsAt: row.starts_at || null,
    endsAt,
    endsAtLabel: formatCaseRentDateTime(endsAt),
    timeLeftLabel: formatCaseRentTimeLeft(endsAt),
    casesCount,
    canExclude: casesCount > 1,
    priceBuyCents: row.price_buy_cents,
    priceRentCents: row.price_rent_cents,
    buyPriceEur,
    rentPriceEur,
    buyPriceLabel: buyPriceEur ? `€${buyPriceEur}` : '',
    rentPerDayLabel: rentPriceEur ? `€${rentPriceEur}` : '',
    rentPriceLabel: rentPriceEur ? `€${rentPriceEur}` : '',
    purchasePriceLabel: buyPriceEur ? `€${buyPriceEur}` : '',
    priceLabel: rentPriceEur ? `Rent €${rentPriceEur}` : buyPriceEur ? `Buy €${buyPriceEur}` : '',
    detailsUrl: slug ? `/templates/${encodeURIComponent(slug)}` : '/templates',
    liveDemoUrl: templateDemoUrl,
    previewUrl: resolveCaseTemplatePreviewUrl(row, slug),
    availableCases: [],
  };
}


function normalizeCaseRentRow(row) {
  const source = String(row.source || row.hold_source || row.reservation_source || 'rent').toLowerCase();
  const isActiveRent = source.includes('rent');

  const expiresAt =
    row.rent_expires_at ||
    row.expires_at ||
    row.reserved_until ||
    row.rented_until ||
    row.ends_at ||
    row.hold_until ||
    null;

  const priceRaw =
    row.active_rent_price_eur ||
    row.daily_rent_price_eur ||
    row.rent_price_eur ||
    row.price_eur ||
    row.rentPriceEur ||
    0;

  return {
    ...row,
    id: row.id || row.template_id,
    title: row.title || row.template_title || 'Untitled template',
    source,
    sourceLabel: isActiveRent ? 'RENT' : 'RESERVE',
    reservationLabel: isActiveRent ? 'Active rent reservation' : 'Owner reserve',
    reservationText: isActiveRent
      ? 'Reserved for this user. Hidden from the public catalog while the rent is active.'
      : 'Held by owner-reserve workflow.',
    casesCount: Number(row.cases_count || row.casesCount || 0),
    assignedCases: Array.isArray(row.assignedCases) ? row.assignedCases : [],
    availableCases: Array.isArray(row.availableCases) ? row.availableCases : [],
    canRemoveAssignments: Boolean(row.canRemoveAssignments),
    lastAssignmentMessage: row.lastAssignmentMessage || '',
    orderId: row.order_id || row.orderId || null,
    rentExpiresAt: expiresAt,
    expiresAtLabel: formatCaseRentDateTime(expiresAt),
    timeLeftLabel: formatCaseRentTimeLeft(expiresAt),
    dailyRentPriceEur: formatCaseRentMoneyEur(priceRaw),
    priceEur: Number(priceRaw || 0),
    isActiveRent,
  };
}


module.exports = { createCabinetPagesRouter };
