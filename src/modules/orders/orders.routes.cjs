'use strict';

const express = require('express');

const { requireAuth } = require('../../middlewares/auth.middleware.cjs');
const ordersController = require('./orders.controller.cjs');

const router = express.Router();

// POST /api/orders/:slug/buy
// Supports BOTH:
// - HTML form submit: application/x-www-form-urlencoded
// - API clients: application/json
router.post(
  '/:slug/buy',
  requireAuth,
  express.urlencoded({ extended: false }),
  express.json(),
  ordersController.buy
);

module.exports = router;
