'use strict';

const express = require('express');

const authMw = require('../../middlewares/auth.middleware.cjs');
const entitlementsCabinetService = require('../../modules/payments/entitlements.cabinet.service.cjs');

function createCabinetPagesRouter({ db } = {}) {
  void db; // keep signature for app.js

  const router = express.Router();

  // Resolve requireAuthPage safely (project exports may differ)
  const requireAuthPage =
    authMw.requireAuthPage ||
    authMw.requireAuth ||
    authMw.requireAuthHtml ||
    authMw.requireAuthWeb ||
    function requireAuthPageFallback(req, res, next) {
      if (req.user && (req.user.id || req.user.user_id)) return next();
      return res.redirect('/auth/login');
    };

  // Make Cabinet layout + cabinet.css always active (main.hbs uses isCabinet)
  router.use((req, res, next) => {
    res.locals.isCabinet = true;
    next();
  });

  // /cabinet -> redirect to default workspace
  router.get('/', requireAuthPage, (req, res) => {
    return res.redirect('/cabinet/cases');
  });

  router.get('/cases', requireAuthPage, (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'cases',
      pageTitle: 'Cases',
      pageSubtitle: 'Client shortlists and presentations.',
      panelTitle: 'Cases',
      panelText: 'Open Cases Browse Templates'
    });
  });

  router.get('/my-templates', requireAuthPage, async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?.user_id;

      // Try common service method names (avoid crashes)
      let entitlements = [];
      if (typeof entitlementsCabinetService.getForUser === 'function') {
        entitlements = await entitlementsCabinetService.getForUser(userId);
      } else if (typeof entitlementsCabinetService.listForUser === 'function') {
        entitlements = await entitlementsCabinetService.listForUser(userId);
      } else if (typeof entitlementsCabinetService.getCabinetEntitlements === 'function') {
        entitlements = await entitlementsCabinetService.getCabinetEntitlements(userId);
      }

      res.render('pages/cabinet', {
        activeSpace: 'my-templates',
        pageTitle: 'My Templates',
        pageSubtitle: 'Your purchased and rented templates.',
        panelTitle: 'Library',
        panelText: '',
        entitlements
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/finance', requireAuthPage, (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'finance',
      pageTitle: 'Finance',
      pageSubtitle: 'Orders and payments.',
      panelTitle: 'Finance',
      panelText: ''
    });
  });

  router.get('/profile', requireAuthPage, (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'profile',
      pageTitle: 'Profile & Security',
      pageSubtitle: 'Account settings.',
      panelTitle: 'Profile',
      panelText: ''
    });
  });

  router.get('/support', requireAuthPage, (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'support',
      pageTitle: 'Support',
      pageSubtitle: 'Help and documentation.',
      panelTitle: 'Support',
      panelText: ''
    });
  });

  return router;
}

/**
 * Export as named property for ESM named import:
 *   import { createCabinetPagesRouter } from './cabinet.pages.routes.cjs'
 */
module.exports = { createCabinetPagesRouter };
