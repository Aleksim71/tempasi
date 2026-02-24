'use strict';

const express = require('express');

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
        invested: 0
      }
    };

    next();
  });

  // Root -> seller-first workspace
  router.get('/', (req, res) => res.redirect('/cabinet/my-templates'));

  router.get('/my-templates', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'my-templates',
      pageTitle: 'My Templates',
      pageSubtitle: 'Your purchased and rented templates.',
      panelTitle: 'Library',
      panelText: ''
    });
  });

  router.get('/cases', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'cases',
      pageTitle: 'Cases',
      pageSubtitle: 'Client shortlists and presentations.',
      panelTitle: 'Cases',
      panelText: ''
    });
  });

  router.get('/finance', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'finance',
      pageTitle: 'Finance',
      pageSubtitle: 'Orders and transactions overview.',
      panelTitle: 'Finance',
      panelText: ''
    });
  });

  router.get('/profile', (req, res) => {
    res.render('pages/cabinet', {
      activeSpace: 'profile',
      pageTitle: 'Profile & Security',
      pageSubtitle: 'Account settings.',
      panelTitle: 'Profile',
      panelText: ''
    });
  });

  router.get('/support', (req, res) => {
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

module.exports = { createCabinetPagesRouter };
