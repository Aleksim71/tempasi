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

  router.post('/my-templates/:id/status', async (req, res) => {
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

  router.get('/my-templates/:id/edit', async (req, res) => {
    const pool = getPool();
    const id = Number(req.params.id);

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

    res.render('pages/cabinet', {
      activeSpace: 'my-templates',
      isMyTemplatesList: false,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: false,
      isMyTemplatesEdit: true,
      workspaceData: { items: [] },
      workspaceError,
      form: row
        ? {
            title: row.title || '',
            slug: row.slug || '',
            shortDescription: row.short_description || '',
            priceBuy:
              row.price_buy_cents !== null && row.price_buy_cents !== undefined
                ? formatMoneyEurFromCents(row.price_buy_cents)
                : '',
            priceRent:
              row.price_rent_cents !== null && row.price_rent_cents !== undefined
                ? formatMoneyEurFromCents(row.price_rent_cents)
                : '',
            status: row.status || 'draft',
          }
        : { title: '', slug: '', shortDescription: '', priceBuy: '', priceRent: '', status: 'draft' },
      formErrors: {},
      formIsDraft: row ? row.status === 'draft' : true,
      formIsPublished: row ? row.status === 'published' : false,
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
      await sellerTemplatesService.updateSellerTemplate({
        pool,
        user: req.user,
        id,
        body: req.body,
        file: req.file || null,
      });

      return res.redirect('/cabinet/my-templates');
    } catch (e) {
      if (e && e.message === 'ONLY_ZIP_ALLOWED') {
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
      form,
      formErrors,
      formIsDraft: status === 'draft',
      formIsPublished: status === 'published',
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

    // Cases are still MVP placeholders.
    const demoCases = [
      { id: 1, title: 'Client Alpha', status: 'open', templatesCount: 2 },
      { id: 2, title: 'Client Beta', status: 'open', templatesCount: 0 },
      { id: 3, title: 'Client Gamma', status: 'closed', templatesCount: 1 },
    ];

    let rents = [];
    let analytics = {
      activeCases: 2,
      heldTemplates: 0,
      activeRentCostEur: '0.00',
    };

    try {
      const rentsResult = await pool.query(
        `
          SELECT
            e.id,
            e.template_slug,
            e.starts_at,
            e.ends_at,
            e.created_at,
            o.amount_cents,
            o.currency,
            COALESCE(st.title, e.template_slug) AS template_title
          FROM public.entitlements e
          LEFT JOIN public.orders o
            ON o.id = e.order_id
          LEFT JOIN public.seller_templates st
            ON st.slug = e.template_slug
          WHERE e.user_id = $1
            AND UPPER(COALESCE(e.deal_type, e.kind, '')) = 'RENT'
            AND (e.ends_at IS NULL OR e.ends_at > NOW())
          ORDER BY e.ends_at ASC NULLS LAST, e.created_at DESC, e.id DESC
        `,
        [userId],
      );

      let activeRentCostCents = 0;

      rents = (rentsResult.rows || []).map((row) => {
        const amountCents = Number(row.amount_cents || 0);
        if (Number.isFinite(amountCents)) activeRentCostCents += amountCents;

        const slug = row.template_slug || '';

        return {
          id: row.id,
          title: row.template_title || slug,
          templateSlug: slug,
          source: 'rent',
          casesCount: 0,
          startsAt: formatDateYMD(row.starts_at || row.created_at),
          endsAt: formatDateYMD(row.ends_at),
          amountEur: formatMoneyEurFromCents(amountCents),
          detailsHref: `/templates/${encodeURIComponent(slug)}`,
        };
      });

      analytics = {
        activeCases: demoCases.filter((item) => item.status === 'open').length,
        heldTemplates: rents.length,
        activeRentCostEur: formatMoneyEurFromCents(activeRentCostCents),
      };
    } catch (e) {
      workspaceError = e;
    }

    res.render('pages/cabinet', {
      activeSpace: 'cases',
      pageTitle: 'Cases',
      pageSubtitle: 'Client shortlists and presentations.',
      panelTitle: 'Cases',
      panelText: '',
      workspaceError,
      workspaceData: {
        cases: {
          tab,
          tabs: [
            { key: 'list', label: 'List', href: '/cabinet/cases?tab=list', isActive: tab === 'list' },
            { key: 'create', label: 'Create', href: '/cabinet/cases?tab=create', isActive: tab === 'create' },
            { key: 'rents', label: 'Rents', href: '/cabinet/cases?tab=rents', isActive: tab === 'rents' },
            { key: 'analytics', label: 'Analytics', href: '/cabinet/cases?tab=analytics', isActive: tab === 'analytics' },
          ],
          items: demoCases,
          rents,
          analytics,
        },
      },
    });
  });

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

      overview = {
        totalOrders: buyCount + rentCount,
        buyOrders: buyCount,
        rentOrders: rentCount,
        ownRevenueEur: '0.00',
        procurementEur: formatMoneyEurFromCents(paidBuyTotal + paidRentTotal),
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
            email: req?.user?.email || '',
          },
          downloads,
        },
      },
    });
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

module.exports = { createCabinetPagesRouter };
