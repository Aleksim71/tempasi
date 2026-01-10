'use strict';

const express = require('express');
const router = express.Router();

const { handleCheckoutSuccessDev } = require('./checkoutSuccessDev.controller.cjs');

// GET /checkout/success
router.get('/success', (req, res, next) => {
  handleCheckoutSuccessDev(req, res).catch(next);
});

module.exports = router;
