'use strict';

const express = require('express');

function webRoutes() {
  const router = express.Router();

  const homeController = require('./controllers/home.controller.cjs');
  const templatesController = require('./controllers/templates.controller.cjs');
  const templateDetailsController = require('./controllers/templateDetails.controller.cjs');
  const previewController = require('./controllers/preview.controller.cjs');

  router.get('/', homeController.index);
  router.get('/templates', templatesController.index);
  router.get('/templates/:slug', templateDetailsController.show);
  router.get('/preview/:slug', previewController.show);

  return router;
}

module.exports = { webRoutes };
