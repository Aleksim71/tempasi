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
const CreditLedgerController = require("../../modules/finance/creditLedger.controller.cjs");

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
          items: caseItems,
          lastCaseDeleteMessage: casesService.LAST_CASE_DELETE_MESSAGE,
          rents,
          analytics,
        },
      },
    });
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
