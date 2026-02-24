'use strict';

const express = require('express');

// Canonical entitlements service (no templates JOIN)
const entitlementsService = require('../../modules/payments/entitlements.service.cjs');

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

// src/web/routes/cabinet.pages.routes.cjs
function createCabinetPagesRouter({ db } = {}) {
  void db;

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

  // Root -> seller-first workspace
  router.get('/', (req, res) => res.redirect('/cabinet/my-templates'));

  // =========================
  // My Templates (with tabs)
  // =========================

  router.get('/my-templates', async (req, res) => {
    let workspaceError = null;
    let items = [];

    try {
      // requires req.user to exist (usually ensured by auth middleware earlier)
      const rows = await entitlementsService.listUserEntitlementsWithTemplates(req.user);
      items = mapEntitlementsToWorkspaceItems(rows);
    } catch (e) {
      workspaceError = e;
    }

    res.render('pages/cabinet', {
      activeSpace: 'my-templates',

      // Tab flags (no custom helpers needed)
      isMyTemplatesLibrary: true,
      isMyTemplatesAdd: false,
      isMyTemplatesAnalytics: false,

      // Data for partial
      workspaceData: { items },
      workspaceError,

      // These are hidden in cabinet.hbs for my-templates, but keep them sane
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

      // Keep shape stable for partial
      workspaceData: { items: [] },
      workspaceError: null,

      pageTitle: 'Add Template',
      pageSubtitle: 'Upload and publish a template.',
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
