// src/web/routes/cabinet.pages.routes.cjs
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const sellerTemplatesService = require('../../modules/templates/sellerTemplates.service.cjs');
const sellerTemplatesRepo = require('../../modules/templates/sellerTemplates.repo.cjs');
const analyticsService = require('../modules/analytics/analytics.cabinet.service.cjs');

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
    fileSize: 50 * 1024 * 1024,
  },
});

function createCabinetPagesRouter() {
  const router = express.Router();

  router.use((req, res, next) => {
    res.locals.isCabinet = true;
    res.locals.metrics = {
      today: { revenue: 0, invested: 0 },
    };
    next();
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

    try {
      const rows = await sellerTemplatesService.listMyTemplates({ pool, user: req.user });

      items = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        status: r.status,
        is_published: r.status === 'published',
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
        // for cache-busting preview on updates
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
      await sellerTemplatesService.updateMyTemplateStatus({
        pool,
        user: req.user,
        id: Number(id),
        status: nextStatus,
      });

      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      // If publish blocked by requirements -> redirect to edit
      if (e && (e.code === 'PUBLISH_VALIDATION_FAILED' || e.code === 'PUBLISH_ZIP_INVALID')) {
        return res.redirect(`/cabinet/my-templates/${Number(id)}/edit`);
      }
      return res.status(500).send(`Status error: ${e.message}`);
    }
  });

  // =========================
  // Edit (MVP) + Replace ZIP
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
      currentZipName: row ? row.zip_original_name || '' : '',
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

  router.post('/my-templates/:id/edit', upload.single('templateZip'), async (req, res) => {
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
      currentZipName: '',
    };

    let workspaceError = null;
    let formErrors = {};

    try {
      // fetch current zip name to show in form on error
      const row = await sellerTemplatesRepo.getSellerTemplateForOwnerById({
        pool,
        ownerUserId,
        id: Number(id),
      });
      if (!row) return res.status(404).send('Not found');
      form.currentZipName = row.zip_original_name || '';

      await sellerTemplatesService.updateSellerTemplate({
        pool,
        user: req.user,
        id: Number(id),
        body: req.body,
        file: req.file || null,
      });

      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      if (e && e.code === 'VALIDATION_FAILED' && e.details && e.details.errors) {
        formErrors = { ...formErrors, ...e.details.errors };
      } else if (e && (e.code === 'SLUG_TAKEN' || e.message === 'SLUG_TAKEN')) {
        formErrors.slug = 'This slug is already used. Choose another one.';
      } else if (e && e.code === 'PREVIEW_NOT_PNG') {
        workspaceError = new Error('PREVIEW_NOT_PNG');
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
  // Delete
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

      await sellerTemplatesService.deleteMyTemplate({
        pool,
        user: req.user,
        id: Number(id),
      });

      // Best effort: remove ZIP and preview
      if (row.zip_path && fs.existsSync(row.zip_path)) {
        try {
          fs.unlinkSync(row.zip_path);
        } catch (_) {}
      }

      const previewPath = path.join(process.cwd(), 'public/uploads/previews', `${Number(id)}.png`);
      if (fs.existsSync(previewPath)) {
        try {
          fs.unlinkSync(previewPath);
        } catch (_) {}
      }

      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      return res.status(500).send(`Delete error: ${e.message}`);
    }
  });

  router.get('/my-templates/analytics', (req, res) => {
    const ownerUserId = getUserId(req);
    if (!ownerUserId) return res.redirect('/login');

    const sort = String(req.query.sort || '').trim() || undefined;
    const dir = String(req.query.dir || '').trim() || undefined;
    const requestedTab = String(req.query.tab || '').trim();
    const allowedTabs = new Set(['overview', 'table', 'advanced']);
    const tab = allowedTabs.has(requestedTab) ? requestedTab : 'overview';

    let workspaceError = null;
    let rows = [];
    let kpis = null;
    let revenueSeries30d = [];
    const sortNormalized = sort || 'total_revenue';
    const dirNormalized = dir === 'asc' ? 'asc' : 'desc';

    const baseQuery = `sort=${encodeURIComponent(sortNormalized)}&dir=${encodeURIComponent(
      dirNormalized,
    )}`;
    const tabs = [
      {
        key: 'overview',
        label: 'Overview',
        href: `/cabinet/my-templates/analytics?tab=overview&${baseQuery}`,
        isActive: tab === 'overview',
      },
      {
        key: 'table',
        label: 'Table',
        href: `/cabinet/my-templates/analytics?tab=table&${baseQuery}`,
        isActive: tab === 'table',
      },
    ];

    const columns = [
      { key: 'template', label: 'Template', sortable: false },
      { key: 'created_at', label: 'Created', sortable: true },
      { key: 'deleted_at', label: 'Archived', sortable: true },
      { key: 'first_order_at', label: 'First order', sortable: true },
      { key: 'sold_at', label: 'Sold at', sortable: true },
      { key: 'rent_count', label: 'Rent count', sortable: true },
      { key: 'rent_revenue', label: 'Rent revenue', sortable: true },
      { key: 'buy_revenue', label: 'Buy revenue', sortable: true },
      { key: 'total_revenue', label: 'Total revenue', sortable: true },
    ].map((c) => {
      const isActive = c.sortable && sortNormalized === c.key;
      const nextDir = isActive && dirNormalized === 'desc' ? 'asc' : 'desc';
      const arrow = isActive ? (dirNormalized === 'asc' ? '↑' : '↓') : '';
      const href = c.sortable
        ? `/cabinet/my-templates/analytics?tab=table&sort=${encodeURIComponent(
            c.key,
          )}&dir=${encodeURIComponent(nextDir)}`
        : '';
      return { ...c, isActive, nextDir, arrow, href };
    });

    Promise.all([
      analyticsService.getMyTemplatesAnalytics({ ownerUserId, sort, dir }),
      analyticsService.getMyTemplatesKpis({ ownerUserId }),
      analyticsService.getMyTemplatesRevenueSeries30d({ ownerUserId }),
    ])
      .then(([items, kpiResult, series]) => {
        rows = Array.isArray(items) ? items : [];
        kpis = kpiResult || null;
        revenueSeries30d = Array.isArray(series) ? series : [];
      })
      .catch((e) => {
        workspaceError = e;
      })
      .finally(() => {
        res.render('pages/cabinet', {
          activeSpace: 'my-templates',

          isMyTemplatesList: false,
          isMyTemplatesAdd: false,
          isMyTemplatesAnalytics: true,
          isMyTemplatesEdit: false,

          workspaceData: {
            analytics: {
              items: rows,
              sort: sortNormalized,
              dir: dirNormalized,
              tab,
              tabs,
              columns,
              kpis: kpis || {
                activeTemplates: 0,
                soldTemplates: 0,
                rentRevenueEur: '0.00',
                totalRevenueEur: '0.00',
              },
              revenueSeries30d,
              revenueSeries30dJson: JSON.stringify(revenueSeries30d || []),
            },
          },
          workspaceError,

          pageTitle: 'Analytics',
          pageSubtitle: 'Sales, rentals and performance.',
          panelTitle: 'Analytics',
          panelText: '',
        });
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
