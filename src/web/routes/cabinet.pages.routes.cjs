// src/web/routes/cabinet.pages.routes.cjs
'use strict';

const express = require('express');

function createCabinetPagesRouter() {
  const router = express.Router();

  function renderSpace(res, space, partial) {
    return res.status(200).render('pages/cabinet/index', {
      bodyClass: 'page-cabinet',
      styles: ['/css/pages/cabinet.css'],
      workspacePartial: partial,
      activeSpace: space,
    });
  }

  router.get('/', (req, res) => res.redirect(302, '/cabinet/cases'));

  router.get('/cases', (req, res) => renderSpace(res, 'cases', 'space-cases'));
  router.get('/my-templates', (req, res) => renderSpace(res, 'my-templates', 'space-my-templates'));
  router.get('/finance', (req, res) => renderSpace(res, 'finance', 'space-finance'));
  router.get('/profile-security', (req, res) => renderSpace(res, 'profile-security', 'space-profile-security'));
  router.get('/support', (req, res) => renderSpace(res, 'support', 'space-support'));

  return router;
}

module.exports = { createCabinetPagesRouter };
