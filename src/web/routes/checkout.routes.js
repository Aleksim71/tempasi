import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  handleCheckoutSuccessDev,
} = require('../../modules/payments/checkoutSuccessDev.controller.cjs');

const router = express.Router();

router.get('/success', async (req, res, next) => {
  try {
    return await handleCheckoutSuccessDev(req, res);
  } catch (err) {
    return next(err);
  }
});

export default router;
