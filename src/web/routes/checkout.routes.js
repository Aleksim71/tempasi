import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  handleCheckoutSuccessDev,
} = require('../../modules/payments/checkoutSuccessDev.controller.cjs');

const router = express.Router();

function devCheckoutSuccessEnabled() {
  return (
    process.env.NODE_ENV !== 'production' || process.env.TEMPASI_ENABLE_DEV_CHECKOUT_SUCCESS === '1'
  );
}

router.get('/success', async (req, res, next) => {
  if (!devCheckoutSuccessEnabled()) {
    return res.status(404).type('text/plain').send('Not found');
  }

  try {
    return await handleCheckoutSuccessDev(req, res);
  } catch (err) {
    return next(err);
  }
});

export default router;
