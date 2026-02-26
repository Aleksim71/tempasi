// src/web/routes/cabinet.pages.routes.cjs
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Seller templates service + repo
const sellerTemplatesService = require('../../modules/templates/sellerTemplates.service.cjs');
const sellerTemplatesRepo = require('../../modules/templates/sellerTemplates.repo.cjs');

// Canonical pool getter (routes/ -> web/ -> src/ -> project root)
const { getPool } = require('../../../scripts/db.pool.cjs');

function requireAuthPage(req, res, next) {
  if (req.user && (req.user.id || req.user.user_id || req.user.userId)) return next();
  return res.redirect('/login');
}

function getUserId(req) {
  return req?.user?.id || req?.user?.user_id || req?.user?.userId || null;
}

function formatMoneyEurFromCents(cents) {
  if (cents === null || cents === undefined) return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
}

// =========================
// Upload (ZIP) — MVP
// =========================

// IMPORTANT:
// - If TEMPLATE_UPLOAD_DIR is set, we REQUIRE it to exist (e.g., sshfs mount).
//   We do NOT silently fallback to local storage — that would hide infra issues.
// - If TEMPLATE_UPLOAD_DIR is NOT set, we use local ./uploads/templates and create it.

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

// Debug (MVP): always print effective upload directory at startup
console.log('[UPLOAD] TEMPLATE_UPLOAD_DIR =', process.env.TEMPLATE_UPLOAD_DIR || '(not set)');
console.log('[UPLOAD] Using UPLOAD_DIR =', UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
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
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

function createCabinetPagesRouter() {
  const router = express.Router();

  // Mark cabinet for layout + inject MVP metrics globally
  router.use((req, res, next) => {
    res.locals.isCabinet = true;

    // Static KPI metrics (MVP)
    res.locals.metrics = {
      today: {
        revenue: 0,
        invested: 0,
      },
    };

    next();
  });

  // Cabinet is protected
  router.use(requireAuthPage);

  // Root -> seller-first workspace
  router.get('/', (req, res) => res.redirect('/cabinet/my-templates'));

  // =========================
  // My Templates (seller workspace)
  // =========================

  router.get('/my-templates', async (req, res) => {
    const pool = getPool();
    let workspaceError = null;
    let items = [];

    try {
      const rows = await sellerTemplatesService.listMyTemplates({ pool, user: req.user });

      items = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        status: r.status,
        is_published: r.status === 'published',
        is_rent_enabled: r.price_rent_cents !== null && r.price_rent_cents !== undefined,
        price_buy_eur:
          r.price_buy_cents !== null && r.price_buy_cents !== undefined
            ? formatMoneyEurFromCents(r.price_buy_cents)
            : '',
        price_rent_eur:
          r.price_rent_cents !== null && r.price_rent_cents !== undefined
            ? formatMoneyEurFromCents(r.price_rent_cents)
            : '',
        zip_ready: Boolean(r.zip_path),
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

      pageTitle: 'My Templates',
      pageSubtitle: 'Your templates for sale and rent.',
      panelTitle: 'My Templates',
      panelText: '',
    });
  });

  router.get('/my-templates/add', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesList: false,
      isMyTemplatesAdd: true,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: false,

      workspaceData: { items: [] },
      workspaceError: null,

      // Form state
      form: { title: '', slug: '', shortDescription: '', priceBuy: '', priceRent: '', status: 'draft' },
      formErrors: {},
      formIsDraft: true,
      formIsPublished: false,

      pageTitle: 'Add Template',
      pageSubtitle: 'Create a template record (MVP).',
      panelTitle: 'Add Template',
      panelText: '',
    });
  });

  router.post('/my-templates/add', upload.single('templateZip'), async (req, res) => {
    const form = {
      title: String(req.body?.title || ''),
      slug: String(req.body?.slug || ''),
      shortDescription: String(req.body?.shortDescription || ''),
      priceBuy: String(req.body?.priceBuy || ''),
      priceRent: String(req.body?.priceRent || ''),
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

      const pool = getPool();
      await sellerTemplatesService.addSellerTemplate({
        pool,
        user: req.user,
        body: req.body,
        file,
      });

      // ✅ after successful create -> go to list
      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      if (e && e.message === 'ONLY_ZIP_ALLOWED') {
        formErrors.templateZip = 'Only .zip files are allowed.';
      } else if (e && e.code === 'LIMIT_FILE_SIZE') {
        formErrors.templateZip = 'ZIP is too large (max 50MB).';
      } else if (e && e.message === 'ZIP_REQUIRED') {
        // already set
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
      isMyTemplatesAdd: true,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: false,

      workspaceData: { items: [] },
      workspaceError,

      form,
      formErrors,
      formIsDraft: status === 'draft',
      formIsPublished: status === 'published',

      pageTitle: 'Add Template',
      pageSubtitle: 'Create a template record (MVP).',
      panelTitle: 'Add Template',
      panelText: '',
    });
  });

  // =========================
  // Status toggle (Publish/Unpublish)
  // =========================
  router.post('/my-templates/:id/status', async (req, res) => {
    const pool = getPool();
    const ownerUserId = getUserId(req);
    const id = String(req.params.id || '').trim();

    if (!ownerUserId) return res.redirect('/login');
    if (!id || !/^\d+$/.test(id)) return res.status(400).send('Bad template id');

    const nextStatus = String(req.body?.status || '').trim();

    if (!['draft', 'published'].includes(nextStatus)) {
      return res.status(400).send('Bad status');
    }

    try {
      // Rule: publish allowed only when mandatory data is present.
      if (nextStatus === 'published') {
        const row = await sellerTemplatesRepo.getSellerTemplateForOwnerById({
          pool,
          ownerUserId,
          id: Number(id),
        });

        if (!row) return res.status(404).send('Not found');

        const hasTitle = Boolean(String(row.title || '').trim());
        const hasSlug = Boolean(String(row.slug || '').trim());
        const hasZip = Boolean(row.zip_path);

        // MVP mandatory: title + slug + zip + (buy or rent price > 0)
        const hasBuy = Number.isFinite(row.price_buy_cents) && row.price_buy_cents > 0;
        const hasRent = Number.isFinite(row.price_rent_cents) && row.price_rent_cents > 0;

        if (!hasTitle || !hasSlug || !hasZip || (!hasBuy && !hasRent)) {
          // per your flow: redirect to Edit if publish can't happen
          return res.redirect(`/cabinet/my-templates/${Number(id)}/edit`);
        }
      }

      await sellerTemplatesService.updateMyTemplateStatus({
        pool,
        user: req.user,
        id: Number(id),
        status: nextStatus,
      });

      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      return res.status(500).send(`Status error: ${e.message}`);
    }
  });

  // =========================
  // Edit (MVP)
  // =========================
  router.get('/my-templates/:id/edit', async (req, res) => {
    const pool = getPool();
    const ownerUserId = getUserId(req);
    const id = String(req.params.id || '').trim();

    if (!ownerUserId) return res.redirect('/login');
    if (!id || !/^\d+$/.test(id)) return res.status(400).send('Bad template id');

    let workspaceError = null;
    let row = null;

    try {
      row = await sellerTemplatesRepo.getSellerTemplateForOwnerById({
        pool,
        ownerUserId,
        id: Number(id),
      });
      if (!row) return res.status(404).send('Not found');
    } catch (e) {
      workspaceError = e;
    }

    const form = {
      id: row ? row.id : id,
      title: row ? row.title : '',
      slug: row ? row.slug : '',
      shortDescription: row ? row.short_description || '' : '',
      priceBuy:
        row && row.price_buy_cents !== null && row.price_buy_cents !== undefined
          ? formatMoneyEurFromCents(row.price_buy_cents)
          : '',
      priceRent:
        row && row.price_rent_cents !== null && row.price_rent_cents !== undefined
          ? formatMoneyEurFromCents(row.price_rent_cents)
          : '',
      status: row ? row.status : 'draft',
    };

    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesList: false,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: true,

      workspaceData: { items: [] },
      workspaceError,

      form,
      formErrors: {},
      formIsDraft: form.status === 'draft',
      formIsPublished: form.status === 'published',

      pageTitle: 'Edit Template',
      pageSubtitle: 'Update your template.',
      panelTitle: 'Edit Template',
      panelText: '',
    });
  });

  router.post('/my-templates/:id/edit', async (req, res) => {
    const pool = getPool();
    const ownerUserId = getUserId(req);
    const id = String(req.params.id || '').trim();

    if (!ownerUserId) return res.redirect('/login');
    if (!id || !/^\d+$/.test(id)) return res.status(400).send('Bad template id');

    const form = {
      id,
      title: String(req.body?.title || '').trim(),
      slug: String(req.body?.slug || '').trim(),
      shortDescription: String(req.body?.shortDescription || '').trim(),
      priceBuy: String(req.body?.priceBuy || '').trim(),
      priceRent: String(req.body?.priceRent || '').trim(),
      status: String(req.body?.status || 'draft').trim(),
    };

    let workspaceError = null;
    let formErrors = {};

    try {
      // NOTE: keep your existing service call (если у тебя реализация уже есть)
      await sellerTemplatesService.updateSellerTemplate({
        pool,
        user: req.user,
        id: Number(id),
        body: req.body,
      });

      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      if (e && e.code === 'VALIDATION_FAILED' && e.details && e.details.errors) {
        formErrors = { ...formErrors, ...e.details.errors };
      } else if (e && (e.code === 'SLUG_TAKEN' || e.message === 'SLUG_TAKEN')) {
        formErrors.slug = 'This slug is already used. Choose another one.';
      } else {
        workspaceError = e;
      }
    }

    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesList: false,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: true,

      workspaceData: { items: [] },
      workspaceError,

      form,
      formErrors,
      formIsDraft: form.status === 'draft',
      formIsPublished: form.status === 'published',

      pageTitle: 'Edit Template',
      pageSubtitle: 'Update your template.',
      panelTitle: 'Edit Template',
      panelText: '',
    });
  });

  // =========================
  // Delete (MVP soft delete)
  // =========================
  router.post('/my-templates/:id/delete', async (req, res) => {
    const pool = getPool();
    const ownerUserId = getUserId(req);
    const id = String(req.params.id || '').trim();

    if (!ownerUserId) return res.redirect('/login');
    if (!id || !/^\d+$/.test(id)) return res.status(400).send('Bad template id');

    try {
      const row = await sellerTemplatesRepo.getSellerTemplateForOwnerById({
        pool,
        ownerUserId,
        id: Number(id),
      });
      if (!row) return res.status(404).send('Not found');

      // ✅ use service (soft delete)
      await sellerTemplatesService.deleteMyTemplate({
        pool,
        user: req.user,
        id: Number(id),
      });

      // Best effort: remove ZIP file from disk
      if (row.zip_path && fs.existsSync(row.zip_path)) {
        try {
          fs.unlinkSync(row.zip_path);
        } catch (_) {
          // ignore
        }
      }

      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      return res.status(500).send(`Delete error: ${e.message}`);
    }
  });

  // =========================
  // Owner download (internal)
  // =========================
  router.get('/my-templates/:id/download', async (req, res) => {
    const ownerUserId = getUserId(req);
    const id = String(req.params.id || '').trim();

    if (!ownerUserId) return res.redirect('/login');
    if (!id || !/^\d+$/.test(id)) return res.status(400).send('Bad template id');

    try {
      const pool = getPool();
      const row = await sellerTemplatesRepo.getSellerTemplateForOwnerById({
        pool,
        ownerUserId,
        id: Number(id),
      });

      if (!row) return res.status(404).send('Not found');
      if (!row.zip_path) return res.status(404).send('No ZIP uploaded');

      const zipPath = row.zip_path;

      if (!fs.existsSync(zipPath)) return res.status(404).send('File missing on disk');

      const baseNameRaw = row.zip_original_name || `${row.slug || 'template'}.zip`;
      const safeName = String(baseNameRaw).replace(/[^\w.\-]+/g, '_');

      return res.download(zipPath, safeName);
    } catch (e) {
      return res.status(500).send(`Download error: ${e.message}`);
    }
  });

  router.get('/my-templates/analytics', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesList: false,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: true,
      isMyTemplatesEdit: false,

      workspaceData: { items: [] },
      workspaceError: null,

      pageTitle: 'Analytics',
      pageSubtitle: 'Sales, rentals and performance.',
      panelTitle: 'Analytics',
      panelText: '',
    });
  });

  // =========================
  // Other Cabinet Spaces
  // =========================

  router.get('/cases', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'cases',
      pageTitle: 'Cases',
      pageSubtitle: 'Client shortlists and presentations.',
      panelTitle: 'Cases',
      panelText: '',
    });
  });

  router.get('/finance', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'finance',
      pageTitle: 'Finance',
      pageSubtitle: 'Orders and transactions overview.',
      panelTitle: 'Finance',
      panelText: '',
    });
  });

  router.get('/profile', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'profile',
      pageTitle: 'Profile & Security',
      pageSubtitle: 'Account settings.',
      panelTitle: 'Profile',
      panelText: '',
    });
  });

  router.get('/support', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'support',
      pageTitle: 'Support',
      pageSubtitle: 'Help and documentation.',
      panelTitle: 'Support',
      panelText: '',
    });
  });

  return router;
}

module.exports = { createCabinetPagesRouter };
