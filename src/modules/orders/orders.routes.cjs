'use strict';

const express = require('express');
const router = express.Router();

const OrdersController = require('./orders.controller.cjs');

// POST /api/orders/:slug/buy
router.post('/:slug/buy', express.json(), (req, res, next) => {
  OrdersController.buyTemplate(req, res).catch(next);
});

module.exports = router;
