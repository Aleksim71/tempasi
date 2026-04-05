// src/modules/profile/profile.routes.cjs
'use strict';

const express = require('express');
const { requireAuth } = require('../../middlewares/auth.middleware.cjs');

function profileRoutes() {
  const router = express.Router();

  router.get('/', requireAuth, (req, res) => {
    return res.status(200).send('Profile page');
  });

  return router;
}

module.exports = { profileRoutes };
