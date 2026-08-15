// path: src/web/routes/cart.checkout-pass.routes.js
import express from 'express';
import { createRequire } from 'node:module';
import {
  checkoutCartPass,
  removeSoldItemsFromCart,
} from '../services/cart.checkout-pass.service.js';

const require = createRequire(import.meta.url);
const { renderStandalonePage } = require('../helpers/renderStandalonePage.cjs');

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
    if (error && error.code === 'BUY_ALREADY_SOLD' && Array.isArray(error.soldSlugs)) {
      // TEMPASI_ALREADY_SOLD_UX (2026-08-14): this item can never
      // become available again — clean it out of the cart and send
      // the user back with a clear reason instead of a raw 409.
      // getCurrentUserId(req) is re-derived here since `userId` from
      // the try block above is out of scope in this catch.
      const currentUserId = getCurrentUserId(req);
      if (currentUserId) {
        try {
          await removeSoldItemsFromCart({ userId: currentUserId, slugs: error.soldSlugs });
        } catch (_) {
          // best-effort cleanup — the friendly redirect below still
          // happens even if this fails, just with a stale cart item.
        }
      }
      const qs = new URLSearchParams({ error: 'already_sold', slugs: error.soldSlugs.join(',') });
      return res.redirect(303, `/cart?${qs.toString()}`);
    }

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

  return renderStandalonePage(req, res, {
    title: 'Checkout Pass Result — Tempasi',
    bodyHtml: `
      <h1>Checkout pass completed</h1>
      <p><strong>Processed items:</strong> ${count}</p>
      <p><strong>BUY:</strong> ${buy} &nbsp; <strong>RENT:</strong> ${rent}</p>
      ${orderIds ? `<p><strong>Order IDs:</strong> <code>${orderIds}</code></p>` : ''}
      <p class="standalone-page__links">
        <a class="c-btn" href="/cabinet/finance">Finance</a>
        <a class="c-btn" href="/cabinet/profile">Profile</a>
        <a class="c-btn" href="/downloads">Downloads</a>
        <a class="c-btn" href="/cabinet/downloads">Cabinet Downloads</a>
        <a class="c-btn c-btn--primary" href="/cart">Back to cart</a>
      </p>
    `,
  });
});

export default router;
