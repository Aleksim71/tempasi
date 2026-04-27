// path: src/web/routes/cart.checkout-pass.routes.js
import express from 'express';
import { checkoutCartPass } from '../services/cart.checkout-pass.service.js';

const router = express.Router();
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

function cartCheckoutPassEnabled() {
  return (
    process.env.NODE_ENV !== 'production' || process.env.TEMPASI_ENABLE_CART_CHECKOUT_PASS === '1'
  );
}

router.use((req, res, next) => {
  if (!cartCheckoutPassEnabled()) {
    return res.status(404).type('text/plain').send('Not found');
  }

  return next();
});

function getCurrentUserId(req) {
  const candidates = [
    req?.session?.user?.id,
    req?.session?.userId,
    req?.user?.id,
    req?.auth?.userId,
    req?.currentUser?.id,
    req?.locals?.user?.id,
    req?.res?.locals?.currentUser?.id,
    req?.res?.locals?.user?.id,
  ];

  for (const raw of candidates) {
    const value = Number.parseInt(String(raw), 10);
    if (Number.isInteger(value) && value > 0) return value;
  }

  return null;
}

function collectSelectedIds(req) {
  const body = req.body || {};
  const query = req.query || {};
  const raw = [];

  const keys = [
    'selected_item_ids',
    'selectedItemIds',
    'cart_item_ids',
    'cartItemIds',
    'item_ids',
    'itemIds',
  ];

  for (const key of keys) {
    const bodyValue = body[key];
    const queryValue = query[key];

    if (Array.isArray(bodyValue)) raw.push(...bodyValue);
    else if (bodyValue != null) raw.push(bodyValue);

    if (Array.isArray(queryValue)) raw.push(...queryValue);
    else if (queryValue != null) raw.push(queryValue);
  }

  const out = [];
  for (const value of raw) {
    if (Array.isArray(value)) {
      out.push(...value);
      continue;
    }

    const text = String(value);
    if (text.includes(',')) {
      out.push(...text.split(','));
      continue;
    }

    out.push(text);
  }

  return out;
}

router.post(['/cart/checkout', '/cart/checkout-pass', '/checkout/pass'], async (req, res, next) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).send('Authentication required');
    }

    const result = await checkoutCartPass({
      req,
      userId,
      selectedItemIds: collectSelectedIds(req),
    });

    const params = new URLSearchParams();
    params.set('count', String(result.count));
    params.set('buy', String(result.buyCount));
    params.set('rent', String(result.rentCount));
    if (result.orderIds.length > 0) {
      params.set('order_ids', result.orderIds.join(','));
    }

    if (result.checkoutUrl) {
      return res.redirect(303, result.checkoutUrl);
    }

    return res.redirect(`/checkout/pass/result?${params.toString()}`);
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).send(error.message);
    }
    return next(error);
  }
});

router.get('/checkout/pass/result', (req, res) => {
  const count = Number.parseInt(String(req.query.count || '0'), 10) || 0;
  const buy = Number.parseInt(String(req.query.buy || '0'), 10) || 0;
  const rent = Number.parseInt(String(req.query.rent || '0'), 10) || 0;
  const orderIds = String(req.query.order_ids || '');

  return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Checkout Pass Result</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; line-height: 1.5; }
      .card { border: 1px solid #ddd; border-radius: 12px; padding: 20px; }
      h1 { margin-top: 0; }
      .links a { display: inline-block; margin-right: 12px; margin-top: 10px; }
      code { background: #f5f5f5; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Checkout pass completed</h1>
      <p><strong>Processed items:</strong> ${count}</p>
      <p><strong>BUY:</strong> ${buy} &nbsp; <strong>RENT:</strong> ${rent}</p>
      ${orderIds ? `<p><strong>Order IDs:</strong> <code>${orderIds}</code></p>` : ''}
      <div class="links">
        <a href="/cabinet/finance">Finance</a>
        <a href="/cabinet/profile">Profile</a>
        <a href="/downloads">Downloads</a>
        <a href="/cabinet/downloads">Cabinet Downloads</a>
        <a href="/cart">Back to cart</a>
      </div>
    </div>
  </body>
</html>`);
});

export default router;
