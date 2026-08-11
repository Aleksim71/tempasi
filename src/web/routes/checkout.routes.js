import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  handleCheckoutSuccessDev,
} = require('../../modules/payments/checkoutSuccessDev.controller.cjs');

const router = express.Router();
const CheckoutCancelController = require('../../modules/payments/checkoutCancel.controller.cjs');
const ordersService = require('../../modules/orders/orders.service.cjs');

router.use(express.urlencoded({ extended: false }));

function devCheckoutSuccessEnabled() {
  return (
    process.env.NODE_ENV !== 'production' || process.env.TEMPASI_ENABLE_DEV_CHECKOUT_SUCCESS === '1'
  );
}

function getCheckoutUserId(req) {
  const raw =
    req?.user?.id ??
    req?.user?.user_id ??
    req?.user?.userId ??
    req?.session?.userId ??
    req?.session?.user_id ??
    req?.userId ??
    null;

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatCheckoutMoneyEur(cents) {
  const n = Number(cents || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `€${(n / 100).toFixed(2)}`;
}

function safeReturnPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('/')) return '';
  if (raw.startsWith('//')) return '';
  if (raw.includes('\\')) return '';
  if (raw.toLowerCase().includes('http://')) return '';
  if (raw.toLowerCase().includes('https://')) return '';
  if (raw.length > 700) return '';
  return raw;
}

async function loadDirectBuyTemplate(db, slug) {
  const { rows } = await db.query(
    `
      SELECT
        slug,
        title,
        short_description,
        preview_url,
        preview_image,
        demo_url,
        owner_user_id,
        price_buy_cents,
        price_rent_cents
      FROM seller_templates
      WHERE slug = $1
        AND status = 'published'
        AND deleted_at IS NULL
        AND owner_withdrawn_at IS NULL
        AND admin_blocked_at IS NULL
      LIMIT 1
    `,
    [slug],
  );

  return rows?.[0] || null;
}

function buildDirectBuyViewModel(tpl, req) {
  const slug = String(tpl.slug || '').trim();
  const caseId = String(req.query?.caseId || req.query?.case_id || req.body?.caseId || '').trim();
  const returnTo =
    safeReturnPath(req.query?.returnTo || req.body?.returnTo) ||
    (caseId
      ? `/cabinet/cases/${encodeURIComponent(caseId)}`
      : `/templates/${encodeURIComponent(slug)}`);

  const previewUrl =
    String(tpl.preview_url || tpl.preview_image || '').trim() ||
    (slug ? `/t/${encodeURIComponent(slug)}/preview/preview.png` : '');

  const demoUrl =
    String(tpl.demo_url || '').trim() ||
    (slug ? `/templates/${encodeURIComponent(slug)}/demo` : '/templates');

  return {
    slug,
    title: tpl.title || slug || 'Untitled template',
    shortDescription: tpl.short_description || '',
    previewUrl,
    demoUrl,
    returnTo,
    caseId,
    buyPriceLabel: formatCheckoutMoneyEur(tpl.price_buy_cents),
    rentPerDayLabel: formatCheckoutMoneyEur(tpl.price_rent_cents),
    amountCents: Number(tpl.price_buy_cents || 0),
  };
}

// Direct BUY review page.
// Buy is not Add to cart. Buy goes directly to final checkout review and then Pay.
router.get('/direct/buy/:slug', async (req, res, next) => {
  try {
    const userId = getCheckoutUserId(req);
    const slug = String(req.params.slug || '').trim();

    if (!userId) {
      return res.redirect(
        303,
        `/login?next=${encodeURIComponent(req.originalUrl || `/checkout/direct/buy/${slug}`)}`,
      );
    }

    const db = req.app.locals?.db;
    if (!db || typeof db.query !== 'function') throw new Error('DB_NOT_CONFIGURED');

    const tpl = await loadDirectBuyTemplate(db, slug);
    if (!tpl) {
      return res.status(404).render('pages/template-not-found', {
        title: 'Template not found — Tempasi',
        bodyClass: 'page-template-details',
        activePage: 'templates',
        styles: ['/css/pages/template-details.css'],
        slug,
      });
    }

    if (Number(tpl.owner_user_id) === Number(userId)) {
      return res.status(403).render('pages/checkout-direct-buy-review', {
        title: 'Cannot buy own template — Tempasi',
        bodyClass: 'checkout-direct',
        styles: ['/css/pages/checkout-direct.css'],
        directBuy: buildDirectBuyViewModel(tpl, req),
        error: 'You cannot buy your own template.',
      });
    }

    return res.status(200).render('pages/checkout-direct-buy-review', {
      title: `Review purchase — ${tpl.title || slug} — Tempasi`,
      bodyClass: 'checkout-direct',
      styles: ['/css/pages/checkout-direct.css'],
      directBuy: buildDirectBuyViewModel(tpl, req),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/direct/buy/:slug/pay', async (req, res, next) => {
  try {
    const userId = getCheckoutUserId(req);
    const slug = String(req.params.slug || '').trim();

    if (!userId) {
      return res.redirect(303, `/login?next=${encodeURIComponent(`/checkout/direct/buy/${slug}`)}`);
    }

    const db = req.app.locals?.db;
    if (!db || typeof db.query !== 'function') throw new Error('DB_NOT_CONFIGURED');

    const tpl = await loadDirectBuyTemplate(db, slug);
    if (!tpl) return res.redirect(303, '/templates?buy_error=template_not_found');

    const result = await ordersService.createOrderCheckout(req, {
      userId,
      templateSlug: slug,
      payload: {
        dealType: 'BUY',
        deal_type: 'BUY',
        license: 'PU',
        currency: 'EUR',
        amountCents: Number(tpl.price_buy_cents || 0),
      },
    });

    return res.redirect(303, result.checkoutUrl);
  } catch (err) {
    const code = err?.code || 'DIRECT_BUY_FAILED';
    return res.redirect(303, `/templates?buy_error=${encodeURIComponent(code)}`);
  }
});

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

router.get('/cancel', CheckoutCancelController.handleCheckoutCancel);

export default router;

// TEMPASI_STEP_6E_BUY_EXCLUSIVITY_UI_ROUTE_CONTRACT
// Checkout route contract:
// If orders.service rejects BUY/RENT because the template already has a completed BUY,
// the route must keep the response user-safe: conflict/unavailable/sold message or safe redirect.
// Do not silently create provider checkout sessions for sold templates.
