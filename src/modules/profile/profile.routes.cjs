'use strict';

const express = require('express');
const { getProfilePage } = require('./profile.controller.cjs');

function profileRoutes() {
  const router = express.Router();

  // GET /profile (SSR)
  router.get('/', getProfilePage);

  return router;
}

module.exports = { profileRoutes };
