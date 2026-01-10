'use strict';

const express = require('express');
const router = express.Router();

const OrdersController = require('./orders.controller.cjs');
const { loadUserFromSession, requireAuth } = require('../../middlewares/auth.middleware.cjs');

// Ensure session -> req.user for ALL /api/orders/* requests
router.use(loadUserFromSession);

// POST /api/orders/:slug/buy
router.post('/:slug/buy', requireAuth, express.json(), async (req, res, next) => {
  try {
    await OrdersController.buy(req, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
