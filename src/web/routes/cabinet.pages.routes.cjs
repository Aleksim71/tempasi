'use strict';

const express = require('express');
const path = require('path');
const multer = require('multer');

// Canonical entitlements service (no templates JOIN)
const entitlementsService = require('../../modules/payments/entitlements.service.cjs');

// Add Template (new)
const sellerTemplatesService = require('../../modules/templates/sellerTemplates.service.cjs');

// Canonical pool getter (NOTE: routes/ -> web/ -> src/ -> project root)
const { getPool } = require('../../../scripts/db.pool.cjs');

function requireAuthPage(req, res, next) {
  if (req.user && (req.user.id || req.user.user_id || req.user.userId)) return next();
  return res.redirect('/login');
}

function formatDateTimeShort(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  // YYYY-MM-DD HH:mm
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function mapEntitlementsToWorkspaceItems(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r) => ({
    template_slug: r.template_slug,
    template_title: r.template_title || r.template_slug, // fallback: show slug
    entitlement_kind: r.kind || r.entitlement_kind || '',
    deal_type: r.deal_type || '',
    entitlement_granted_at: formatDateTimeShort(r.created_at || r.entitlement_granted_at),
    entitlement_ends_at: r.ends_at ? formatDateTimeShort(r.ends_at) : '',
    is_active: Boolean(r.is_active),
    order_id: r.order_id || null,
  }));
}

// =========================
// Upload (ZIP) — MVP
// =========================

const UPLOAD_DIR = path.join(__dirname, '../../../uploads/templates');

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
    const isZipByMime = file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed';

    if (isZipByMime || isZipByName) return cb(null, true);
    return cb(new Error('ONLY_ZIP_ALLOWED'));
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

function createCabinetPagesRouter() {
  const router = express.Router();

  // Mark cabinet for layout + inject MVP metrics globally (so pages don't have to pass them)
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
  // My Templates (with tabs)
  // =========================

  router.get('/my-templates', async (req, res) => {
    let workspaceError = null;
    let items = [];

    try {
      const rows = await entitlementsService.listUserEntitlementsWithTemplates(req.user);
      items = mapEntitlementsToWorkspaceItems(rows);
    } catch (e) {
      workspaceError = e;
    }

    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      // Tab flags
      isMyTemplatesLibrary: true,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: false,

      // Data for partial
      workspaceData: { items },
      workspaceError,

      pageTitle: 'My Templates',
      pageSubtitle: 'Your purchased and rented templates.',
      panelTitle: 'Library',
      panelText: '',
    });
  });

  router.get('/my-templates/add', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesLibrary: false,
      isMyTemplatesAdd: true,
      isMyTemplatesAnalytics: false,

      workspaceData: { items: [] },
      workspaceError: null,

      // Form state
      form: { title: '', slug: '', shortDescription: '', priceBuy: '', priceRent: '', status: 'draft' },
      formErrors: {},

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

      // MVP: redirect to Library
      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      // Multer fileFilter / limits errors often arrive here as plain Error
      if (e && e.message === 'ONLY_ZIP_ALLOWED') {
        formErrors.templateZip = 'Only .zip files are allowed.';
      } else if (e && (e.code === 'LIMIT_FILE_SIZE')) {
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

    return res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesLibrary: false,
      isMyTemplatesAdd: true,
      isMyTemplatesAnalytics: false,

      workspaceData: { items: [] },
      workspaceError,

      form,
      formErrors,

      pageTitle: 'Add Template',
      pageSubtitle: 'Create a template record (MVP).',
      panelTitle: 'Add Template',
      panelText: '',
    });
  });

  router.get('/my-templates/analytics', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      isMyTemplatesLibrary: false,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: true,

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
