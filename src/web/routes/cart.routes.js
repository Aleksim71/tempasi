// src/web/routes/cart.routes.js
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OrdersService = require('../../modules/orders/orders.service.cjs');
const PaymentCompletion = require('../../modules/payments/paymentCompletion.service.cjs');
const { renderStandalonePage } = require('../helpers/renderStandalonePage.cjs');

function escapeHtml(input) {
  return String(input == null ? '' : input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getUserId(req) {
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

function safeNextPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('/')) return '';
  if (raw.startsWith('//')) return '';
  if (raw.includes('\\')) return '';
  if (raw.length > 512) return '';
  if (raw.toLowerCase().includes('http://')) return '';
  if (raw.toLowerCase().includes('https://')) return '';
  return raw;
}

function normalizeRentDays(input) {
  const n = Number.parseInt(String(input || '1'), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 30);
}

function collectCaseIds(body = {}) {
  const raw = [];
  for (const key of ['case_ids', 'caseIds', 'caseId', 'case_id']) {
    const value = body[key];
    if (Array.isArray(value)) raw.push(...value);
    else if (value !== undefined && value !== null) raw.push(value);
  }

  const out = [];
  for (const value of raw) {
    const text = String(value || '').trim();
    if (!text) continue;
    if (text.includes(',')) {
      out.push(
        ...text
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      );
      continue;
    }
    out.push(text);
  }

  return [...new Set(out.map((id) => String(id || '').trim()).filter(Boolean))];
}

async function hasColumn(db, tableName, columnName) {
  const result = await db.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName],
  );
  return Boolean(result.rows?.[0]);
}

async function listOwnedCaseIds(db, userId, caseIds) {
  if (!caseIds.length) return [];
  const result = await db.query(
    `
      SELECT id
      FROM cases
      WHERE user_id::text = $1::text
        AND id::text = ANY($2::text[])
    `,
    [String(userId), caseIds.map(String)],
  );
  return (result.rows || []).map((row) => String(row.id));
}

function formatRentDurationLabel(license) {
  const match = String(license || '').match(/^PU:(\d+)d$/i);
  const days = match ? Number.parseInt(match[1], 10) : 1;
  const safeDays = Number.isFinite(days) && days > 0 ? days : 1;
  return `${safeDays} ${safeDays === 1 ? 'day' : 'days'} reservation`;
}

function redirectToLogin(res, nextPath) {
  const qs = new URLSearchParams();
  const safeNext = safeNextPath(nextPath);
  if (safeNext) qs.set('next', safeNext);
  return res.redirect(302, `/login?${qs.toString()}`);
}

function formatMoneyEurFromCents(cents) {
  const n = Number(cents || 0);
  if (!Number.isFinite(n)) return '0.00';
  return (n / 100).toFixed(2);
}

function formatDateYMD(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// TEMPASI_REAL_MULTI_ITEM_CHECKOUT (2026-08-14)
//
// Processes ALL cart items in one confirmed action, reusing the exact
// same real pipeline as a single-item purchase for each one — no
// parallel/simplified logic, unlike the older demo-checkout below:
//   - ordersService.createOrderCheckout() per item: BUY exclusivity
//     check, credit reservation, order creation, fake payment session
//     (or the zero-pay-via-credit shortcut it already has built in).
//   - PaymentCompletion.completePaidOrder() per item (skipped if
//     createOrderCheckout already completed it via zero-pay) — same
//     function the real webhook and dev checkout-success page call.
//
// BUY items only for now — RENT items are left in the cart untouched
// with a note, since cart_items has no rent_days column yet (rent
// duration isn't captured anywhere in the current cart model) and
// today's testing focus has been BUY exclusivity specifically. A BUY
// item that turns out to already be sold (lost the race to someone
// else) is treated the same way as the single-item checkout path:
// removed from the cart, reported as "already sold", not a hard
// failure for the rest of the batch.
async function checkoutAllCartItems(req, db, userId) {
  // TEMPASI_CHECKOUT_ALL_RENT_SUPPORT (2026-08-16)
  // case_ids added to the SELECT so RENT items can be processed below
  // (previously only needed by demoCompleteCartCheckout()'s own copy
  // of this query further down this file).
  const { rows: items } = await db.query(
    `
      SELECT ci.id, ci.template_slug, ci.deal_type, ci.license, ci.case_ids
      FROM cart_items ci
      WHERE ci.user_id = $1
      ORDER BY ci.created_at ASC, ci.id ASC
    `,
    [userId],
  );

  const purchased = [];
  const alreadySold = [];
  const skippedRent = [];
  const failed = [];

  for (const item of items) {
    const dealType = String(item.deal_type || '').toUpperCase();

    if (dealType !== 'BUY' && dealType !== 'RENT') {
      skippedRent.push(item.template_slug);
      continue;
    }

    try {
      const priceColumn = dealType === 'RENT' ? 'price_rent_cents' : 'price_buy_cents';
      const { rows: tplRows } = await db.query(
        `SELECT title, ${priceColumn} AS price_cents FROM seller_templates WHERE slug = $1 AND status = 'published' LIMIT 1`,
        [item.template_slug],
      );
      const tpl = tplRows[0];
      if (!tpl) {
        failed.push({ slug: item.template_slug, reason: 'Template no longer available.' });
        continue;
      }

      // TEMPASI_CHECKOUT_ALL_RENT_SUPPORT (2026-08-16)
      // RENT items used to be filtered out above before reaching this
      // point at all ("RENT items are not yet supported by bulk
      // checkout"). createOrderCheckout()/createPendingOrder() already
      // fully validate+support RENT (rentDays, caseIds, case
      // ownership — same checks the single-item /:templateSlug/buy
      // route already relies on), so this only needed to stop
      // skipping RENT and build the matching payload — the
      // order_case_assignments row itself is now created inside the
      // canonical completePaidOrder() (see paymentCompletion.service.cjs),
      // not duplicated here.
      const rentDays = dealType === 'RENT' ? parseRentDaysFromLicense(item.license) : null;
      const caseIds = dealType === 'RENT' ? normalizeCaseIdsFromCart(item.case_ids) : [];

      const result = await OrdersService.createOrderCheckout(req, {
        userId,
        templateSlug: item.template_slug,
        payload: {
          dealType,
          deal_type: dealType,
          // TEMPASI_LICENSE_FIX (2026-08-14): cart_items.license for a
          // BUY item currently holds 'BUY' (from the catalog's Buy
          // button hidden field — a pre-existing mismatch, that value
          // is a deal type, not a license tier). orders.service.cjs's
          // normalizeBuyPayload() validates against a real tier list
          // (PU/CU/EL/ML/EX) and rejects 'BUY' with INVALID_LICENSE.
          // The older raw-SQL checkoutCartPass() path tolerated this by
          // never validating it at all. There's no license-tier picker
          // anywhere in the UI, so 'PU' (Personal Use) — the same
          // value the working /checkout/direct/buy/:slug/pay path
          // already hardcodes — is the correct one to use here too,
          // regardless of whatever is actually stored in
          // cart_items.license.
          license: 'PU',
          currency: 'EUR',
          amountCents:
            dealType === 'RENT'
              ? Number(tpl.price_cents || 0) * Number(rentDays || 1)
              : Number(tpl.price_cents || 0),
          rentDays,
          caseIds,
        },
      });

      if (!result.zeroPay) {
        await PaymentCompletion.completePaidOrder({
          orderId: result.orderId,
          providerSessionId: result.sessionId,
          // TEMPASI_UNIQUE_PAYMENT_INTENT_FIX (2026-08-15): this used
          // to be the literal string 'pi_dev_bulk' for every order in
          // the loop, colliding with orders.provider_payment_intent_id's
          // unique constraint the moment a second BUY item was checked
          // out in the same batch. Suffixing with the order's own id
          // guarantees uniqueness per order.
          providerPaymentIntentId: 'pi_dev_bulk_' + result.orderId,
        });
      }

      purchased.push({ slug: item.template_slug, title: tpl.title || item.template_slug });
      await db.query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [item.id, userId]);
    } catch (err) {
      if (err && (err.code === 'TEMPLATE_ALREADY_SOLD' || err.status === 409)) {
        alreadySold.push(item.template_slug);
        await db.query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [item.id, userId]);
      } else {
        // Keep the item in the cart so the user can retry — this is an
        // unexpected failure, not a "someone else already bought it"
        // outcome.
        failed.push({ slug: item.template_slug, reason: err?.message || 'Checkout failed.' });
      }
    }
  }

  return { purchased, alreadySold, skippedRent, failed };
}

function pickNotice(req) {
  if (String(req.query?.added || '').trim()) {
    return 'Item added to cart.';
  }
  if (String(req.query?.exists || '').trim() === '1') {
    return 'Item is already in cart.';
  }
  if (String(req.query?.removed || '').trim() === '1') {
    return 'Item removed from cart.';
  }
  // TEMPASI_ALREADY_SOLD_UX (2026-08-14): set by cart.checkout-pass.routes.js
  // when checkout hits the BUY_ALREADY_SOLD race — someone else bought it
  // first. The item has already been removed from the cart by that route.
  if (String(req.query?.error || '').trim() === 'already_sold') {
    const slugs = String(req.query?.slugs || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return slugs.length > 0
      ? `Sorry — ${slugs.join(', ')} was just purchased by another buyer and has been removed from your cart.`
      : 'Sorry — that template was just purchased by another buyer and has been removed from your cart.';
  }
  const demoCheckout = String(req.query?.demo_checkout || '').trim();
  if (demoCheckout === 'done') {
    return 'Demo checkout complete.';
  }
  if (demoCheckout === 'partial') {
    return 'Demo checkout complete for available items. Unavailable items were skipped and are still in your cart.';
  }
  if (demoCheckout === 'blocked') {
    return 'No items could be checked out — all templates in your cart are no longer available.';
  }
  return '';
}

async function loadCartItems(db, userId) {
  const { rows } = await db.query(
    `
      SELECT
        ci.id,
        ci.template_slug,
        ci.deal_type,
        ci.license,
        ci.created_at,
        COALESCE(st.title, ci.template_slug) AS template_title,
        st.price_buy_cents,
        st.price_rent_cents,
        (
          st.slug IS NOT NULL
          AND st.status = 'published'
          AND st.deleted_at IS NULL
          AND st.admin_blocked_at IS NULL
        ) AS is_available
      FROM cart_items ci
      LEFT JOIN seller_templates st
        ON st.slug = ci.template_slug
      WHERE ci.user_id::text = $1::text
      ORDER BY ci.created_at DESC, ci.id DESC
    `,
    [userId],
  );

  return (rows || []).map((row) => {
    const dealType = String(row.deal_type || 'BUY').toUpperCase();
    const amountCents =
      dealType === 'RENT'
        ? Number(row.price_rent_cents || 0) *
          (Number.parseInt(String(row.license || '').match(/^PU:(\d+)d$/i)?.[1] || '1', 10) || 1)
        : Number(row.price_buy_cents || 0);

    return {
      id: row.id,
      template_slug: row.template_slug || '',
      template_title: row.template_title || row.template_slug || '',
      deal_type: dealType,
      license: row.license || 'PU',
      created_at_str: formatDateYMD(row.created_at),
      amountCents,
      amountEur: formatMoneyEurFromCents(amountCents),
      durationLabel: dealType === 'RENT' ? formatRentDurationLabel(row.license) : '',
      detailsHref: `/templates/${encodeURIComponent(row.template_slug || '')}`,
      // TEMPASI_POSTMODERATION_CART_AVAILABILITY (2026-08-10): a template
      // can be blocked/unpublished/deleted after already being added to
      // someone's cart. We keep the stale item visible (not silently
      // removed) but flag it so the cart page can show it's no longer
      // purchasable, and demo checkout can skip it.
      isAvailable: Boolean(row.is_available),
    };
  });
}

function demoCheckoutEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.TEMPASI_ENABLE_DEMO_CHECKOUT === '1';
}

async function getTableColumns(db, tableName) {
  const { rows } = await db.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName],
  );

  return new Set((rows || []).map((row) => row.column_name));
}

function pickColumn(columns, names) {
  for (const name of names) {
    if (columns.has(name)) return name;
  }
  return null;
}

function normalizeCaseIdsFromCart(value) {
  if (!value) return [];

  let parsed = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (_) {
      parsed = value;
    }
  }

  const raw = Array.isArray(parsed) ? parsed : [parsed];

  return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))];
}

function parseRentDaysFromLicense(license) {
  const match = String(license || '').match(/^PU:([1-9][0-9]*)d$/i);
  if (!match) return 1;
  const days = Number.parseInt(match[1], 10);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 30) : 1;
}

async function demoCompleteCartCheckout(db, userId) {
  const cartColumns = await getTableColumns(db, 'cart_items');
  const orderColumns = await getTableColumns(db, 'orders');
  const entitlementColumns = await getTableColumns(db, 'entitlements');
  const assignmentColumns = await getTableColumns(db, 'order_case_assignments');

  const hasAssignmentsTable = assignmentColumns.size > 0;

  const cartCaseIdsColumn = pickColumn(cartColumns, ['case_ids']);
  const orderIdColumn = pickColumn(orderColumns, ['id']);
  const orderUserIdColumn = pickColumn(orderColumns, [
    'user_id',
    'buyer_user_id',
    'customer_user_id',
  ]);
  const orderSlugColumn = pickColumn(orderColumns, ['template_slug']);
  const orderDealTypeColumn = pickColumn(orderColumns, ['deal_type']);
  const orderLicenseColumn = pickColumn(orderColumns, ['license']);
  const orderStatusColumn = pickColumn(orderColumns, ['status']);
  const orderAmountColumn = pickColumn(orderColumns, [
    'amount_cents',
    'price_cents',
    'total_cents',
  ]);
  const orderCurrencyColumn = pickColumn(orderColumns, ['currency']);
  const orderProviderColumn = pickColumn(orderColumns, ['provider']);
  const orderProviderSessionIdColumn = pickColumn(orderColumns, ['provider_session_id']);
  const orderCaseIdsColumn = pickColumn(orderColumns, ['case_ids']);
  const orderCreatedAtColumn = pickColumn(orderColumns, ['created_at']);
  const orderUpdatedAtColumn = pickColumn(orderColumns, ['updated_at']);

  if (!orderIdColumn || !orderUserIdColumn || !orderSlugColumn || !orderDealTypeColumn) {
    throw new Error('DEMO_CHECKOUT_ORDERS_SCHEMA_MISSING_REQUIRED_COLUMNS');
  }

  const entitlementUserIdColumn = pickColumn(entitlementColumns, ['user_id']);
  const entitlementSlugColumn = pickColumn(entitlementColumns, ['template_slug']);
  const entitlementDealTypeColumn = pickColumn(entitlementColumns, ['deal_type', 'kind']);
  const entitlementKindColumn = pickColumn(entitlementColumns, ['kind']);
  const entitlementStartsAtColumn = pickColumn(entitlementColumns, ['starts_at']);
  const entitlementEndsAtColumn = pickColumn(entitlementColumns, ['ends_at']);
  const entitlementOrderIdColumn = pickColumn(entitlementColumns, ['order_id']);
  const entitlementCreatedAtColumn = pickColumn(entitlementColumns, ['created_at']);
  const entitlementUpdatedAtColumn = pickColumn(entitlementColumns, ['updated_at']);

  const { rows: items } = await db.query(
    `
      SELECT
        ci.id,
        ci.user_id,
        ci.template_slug,
        ci.deal_type,
        ci.license,
        ${cartCaseIdsColumn ? `ci.${cartCaseIdsColumn}` : `NULL::jsonb`} AS case_ids,
        COALESCE(st.price_buy_cents, 0) AS price_buy_cents,
        COALESCE(st.price_rent_cents, 0) AS price_rent_cents,
        (
          st.slug IS NOT NULL
          AND st.status = 'published'
          AND st.deleted_at IS NULL
          AND st.admin_blocked_at IS NULL
        ) AS is_available
      FROM cart_items ci
      LEFT JOIN seller_templates st
        ON st.slug = ci.template_slug
      WHERE ci.user_id::text = $1::text
      ORDER BY ci.created_at ASC, ci.id ASC
      FOR UPDATE OF ci
    `,
    [String(userId)],
  );

  if (!items.length) {
    const error = new Error('DEMO_CHECKOUT_CART_EMPTY');
    error.statusCode = 400;
    throw error;
  }

  const createdOrderIds = [];
  const processedCartItemIds = [];
  const skippedCartItemIds = [];
  const allCaseIds = [];

  for (const item of items) {
    // TEMPASI_POSTMODERATION_CART_AVAILABILITY (2026-08-10): a template
    // sitting in the cart may have been blocked/unpublished/deleted
    // since it was added. Skip it — don't create an order for it, don't
    // remove it from the cart either (per product decision: it stays
    // visible with a "not available" badge, not silently dropped).
    if (!item.is_available) {
      skippedCartItemIds.push(item.id);
      continue;
    }

    const dealType = String(item.deal_type || 'BUY').toUpperCase();
    const caseIds = dealType === 'RENT' ? normalizeCaseIdsFromCart(item.case_ids) : [];

    for (const caseId of caseIds) {
      if (!allCaseIds.includes(caseId)) allCaseIds.push(caseId);
    }

    const amountCents =
      dealType === 'RENT'
        ? Number(item.price_rent_cents || 0) * parseRentDaysFromLicense(item.license)
        : Number(item.price_buy_cents || 0);

    const columns = [orderUserIdColumn, orderSlugColumn, orderDealTypeColumn];
    const values = [String(userId), item.template_slug, dealType];

    if (orderLicenseColumn) {
      columns.push(orderLicenseColumn);
      // orders_license_check does not accept MVP rent duration values like PU:2d.
      // Keep rent duration in cart-derived calculation/entitlement, but store canonical order license.
      values.push('PU');
    }

    if (orderStatusColumn) {
      columns.push(orderStatusColumn);
      values.push('paid');
    }

    if (orderAmountColumn) {
      columns.push(orderAmountColumn);
      values.push(amountCents);
    }

    if (orderCurrencyColumn) {
      columns.push(orderCurrencyColumn);
      values.push('EUR');
    }

    if (orderProviderColumn) {
      columns.push(orderProviderColumn);
      values.push('demo');
    }

    if (orderProviderSessionIdColumn) {
      columns.push(orderProviderSessionIdColumn);
      values.push(`demo_${Date.now()}_${item.id}`);
    }

    if (orderCaseIdsColumn) {
      columns.push(orderCaseIdsColumn);
      values.push(caseIds.length ? JSON.stringify(caseIds) : null);
    }

    if (orderCreatedAtColumn) {
      columns.push(orderCreatedAtColumn);
      values.push(new Date());
    }

    if (orderUpdatedAtColumn) {
      columns.push(orderUpdatedAtColumn);
      values.push(new Date());
    }

    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const orderResult = await db.query(
      `
        INSERT INTO orders (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING ${orderIdColumn} AS id
      `,
      values,
    );

    const orderId = orderResult.rows?.[0]?.id;
    if (!orderId) {
      throw new Error('DEMO_CHECKOUT_ORDER_NOT_CREATED');
    }

    createdOrderIds.push(orderId);
    processedCartItemIds.push(item.id);

    if (
      dealType === 'RENT' &&
      entitlementUserIdColumn &&
      entitlementSlugColumn &&
      entitlementDealTypeColumn
    ) {
      const days = parseRentDaysFromLicense(item.license);
      const entitlementInsertColumns = [
        entitlementUserIdColumn,
        entitlementSlugColumn,
        entitlementDealTypeColumn,
      ];
      const entitlementValues = [String(userId), item.template_slug, 'RENT'];

      if (entitlementKindColumn && entitlementKindColumn !== entitlementDealTypeColumn) {
        entitlementInsertColumns.push(entitlementKindColumn);
        // entitlements.kind check allows lowercase values: buy/rent.
        entitlementValues.push('rent');
      }

      if (entitlementStartsAtColumn) {
        entitlementInsertColumns.push(entitlementStartsAtColumn);
        entitlementValues.push(new Date());
      }

      if (entitlementEndsAtColumn) {
        entitlementInsertColumns.push(entitlementEndsAtColumn);
        entitlementValues.push(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
      }

      if (entitlementOrderIdColumn) {
        entitlementInsertColumns.push(entitlementOrderIdColumn);
        entitlementValues.push(orderId);
      }

      if (entitlementCreatedAtColumn) {
        entitlementInsertColumns.push(entitlementCreatedAtColumn);
        entitlementValues.push(new Date());
      }

      if (entitlementUpdatedAtColumn) {
        entitlementInsertColumns.push(entitlementUpdatedAtColumn);
        entitlementValues.push(new Date());
      }

      const entitlementPlaceholders = entitlementInsertColumns.map((_, index) => `$${index + 1}`);
      await db.query(
        `
          INSERT INTO entitlements (${entitlementInsertColumns.join(', ')})
          VALUES (${entitlementPlaceholders.join(', ')})
        `,
        entitlementValues,
      );
    }

    if (hasAssignmentsTable && caseIds.length > 0) {
      for (const caseId of caseIds) {
        await db.query(
          `
            INSERT INTO order_case_assignments(order_id, case_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,
          [orderId, caseId],
        );
      }
    }
  }

  // Only clear the cart items that actually turned into an order.
  // Skipped (unavailable) items stay in the cart — see the
  // TEMPASI_POSTMODERATION_CART_AVAILABILITY comment above.
  if (processedCartItemIds.length) {
    await db.query(
      `
        DELETE FROM cart_items
        WHERE user_id::text = $1::text
          AND id = ANY($2::bigint[])
      `,
      [String(userId), processedCartItemIds],
    );
  }

  return {
    orderIds: createdOrderIds,
    skippedCount: skippedCartItemIds.length,
    caseIds: allCaseIds,
    redirectTo: allCaseIds[0]
      ? `/cabinet/cases/${encodeURIComponent(allCaseIds[0])}`
      : createdOrderIds.length && skippedCartItemIds.length
        ? '/cart?demo_checkout=partial'
        : createdOrderIds.length
          ? '/cart?demo_checkout=done'
          : '/cart?demo_checkout=blocked',
  };
}

export function createCartRouter() {
  const router = express.Router();

  router.use(express.urlencoded({ extended: false }));

  router.get('/', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return redirectToLogin(res, '/cart');

      const db = req.app.locals?.db;
      if (!db || typeof db.query !== 'function') {
        throw new Error('DB_NOT_CONFIGURED');
      }

      const items = await loadCartItems(db, userId);
      const subtotalCents = items
        .filter((item) => item.isAvailable)
        .reduce((sum, item) => sum + Number(item.amountCents || 0), 0);

      // TEMPASI_CART_BUY_RENT_SPLIT (2026-08-21): BUY and RENT are
      // different commitments (permanent purchase vs. a temporary hold
      // that can convert to credit — see account_credits), so the page
      // groups them into two sections with their own subtotals. Checkout
      // itself stays a single combined action (checkoutAllCartItems
      // already processes BUY and RENT items independently in one pass).
      const buyItems = items.filter((item) => item.deal_type === 'BUY');
      const rentItems = items.filter((item) => item.deal_type === 'RENT');
      const buySubtotalCents = buyItems
        .filter((item) => item.isAvailable)
        .reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
      const rentSubtotalCents = rentItems
        .filter((item) => item.isAvailable)
        .reduce((sum, item) => sum + Number(item.amountCents || 0), 0);

      return res.status(200).render('pages/cart', {
        title: 'Cart',
        styles: ['/css/pages/cart.css'],
        bodyClass: 'cart',
        hideHeader: false,
        hideFooter: false,
        cart: {
          items,
          itemCount: items.length,
          subtotalEur: formatMoneyEurFromCents(subtotalCents),
          buyItems,
          rentItems,
          buyCount: buyItems.length,
          rentCount: rentItems.length,
          buySubtotalEur: formatMoneyEurFromCents(buySubtotalCents),
          rentSubtotalEur: formatMoneyEurFromCents(rentSubtotalCents),
        },
        notice: pickNotice(req),
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/add', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const templateSlug = String(req.body?.template_slug || '').trim();
      const dealType = String(req.body?.deal_type || 'BUY')
        .trim()
        .toUpperCase();
      const rawLicense = String(req.body?.license || 'PU')
        .trim()
        .toUpperCase();
      const rentDays = dealType === 'RENT' ? normalizeRentDays(req.body?.rent_days) : null;
      const license = dealType === 'RENT' && rentDays ? `PU:${rentDays}d` : rawLicense;
      const licenseForValidation = rawLicense;
      const nextPath = safeNextPath(req.body?.next || `/templates/${templateSlug}`) || '/templates';
      const caseIds = dealType === 'RENT' ? collectCaseIds(req.body || {}) : [];

      if (!userId) return redirectToLogin(res, nextPath);
      if (!templateSlug) return res.redirect(302, '/templates');
      if (!['BUY', 'RENT'].includes(dealType)) {
        return res.redirect(302, `${nextPath}?cart=unsupported`);
      }
      // TEMPASI_LICENSE_VALIDATION_MATCH_DB_CHECK (2026-07-31)
      // Used to check against ['PU','CU','EL','ML','EX'] — a 5-tier
      // license model that does NOT match the actual live DB
      // constraint on cart_items.license, which only allows
      // 'BUY' / 'RENT' / 'PU' / 'PU:<days>d'. That mismatch let
      // invalid values (e.g. 'EX') pass this check and then crash
      // with an unhandled DB constraint violation instead of the
      // graceful redirect below, while rejecting the correct 'BUY'
      // value real Buy forms actually send. Matches the DB now.
      if (!['BUY', 'RENT', 'PU'].includes(licenseForValidation)) {
        return res.redirect(302, `${nextPath}?cart=bad_license`);
      }

      if (dealType === 'RENT' && !rentDays) {
        return res.redirect(302, `${nextPath}?cart=rent_days_required`);
      }

      if (dealType === 'RENT' && caseIds.length === 0) {
        return res.redirect(302, `${nextPath}?cart=case_required`);
      }

      const db = req.app.locals?.db;
      if (!db || typeof db.query !== 'function') {
        throw new Error('DB_NOT_CONFIGURED');
      }

      const templateResult = await db.query(
        `
          SELECT slug, owner_user_id, price_buy_cents, price_rent_cents
          FROM seller_templates
          WHERE slug = $1
            AND status = 'published'
            AND deleted_at IS NULL
            AND admin_blocked_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE u.id = seller_templates.owner_user_id
                AND u.self_deleted_at IS NOT NULL
            )
          LIMIT 1
        `,
        [templateSlug],
      );

      const tpl = templateResult.rows?.[0] || null;
      if (!tpl) return res.redirect(302, '/templates');

      if (Number(tpl.owner_user_id) === Number(userId)) {
        return res.redirect(302, `${nextPath}?cart=owner_template`);
      }

      const buyPriceCents = Number(tpl.price_buy_cents || 0);
      const rentPriceCents = Number(tpl.price_rent_cents || 0);

      if (dealType === 'BUY' && (!Number.isFinite(buyPriceCents) || buyPriceCents <= 0)) {
        return res.redirect(302, `${nextPath}?cart=not_buyable`);
      }

      if (dealType === 'RENT' && (!Number.isFinite(rentPriceCents) || rentPriceCents <= 0)) {
        return res.redirect(302, `${nextPath}?cart=not_rentable`);
      }

      const soldResult = await db.query(
        `
          SELECT 1
          FROM orders
          WHERE template_slug = $1
            AND deal_type = 'BUY'
            AND status = 'paid'
          LIMIT 1
        `,
        [templateSlug],
      );
      if (soldResult.rows?.[0]) {
        return res.redirect(302, `${nextPath}?cart=sold`);
      }

      const activeRentResult = await db.query(
        `
          SELECT 1
          FROM entitlements
          WHERE template_slug = $1
            AND UPPER(COALESCE(deal_type, kind, '')) = 'RENT'
            AND closed_at IS NULL
            AND (ends_at IS NULL OR ends_at > NOW())
            AND user_id <> $2
          LIMIT 1
        `,
        [templateSlug, userId],
      );
      if (activeRentResult.rows?.[0]) {
        return res.redirect(302, `${nextPath}?cart=reserved`);
      }

      if (dealType === 'RENT' && caseIds.length > 0) {
        const ownedCaseIds = await listOwnedCaseIds(db, userId, caseIds);
        const ownedSet = new Set(ownedCaseIds.map(String));
        const missing = caseIds.filter((id) => !ownedSet.has(String(id)));
        if (missing.length > 0) {
          return res.redirect(302, `${nextPath}?cart=case_not_owned`);
        }
      }

      const ownedResult = await db.query(
        `
          SELECT 1
          FROM entitlements
          WHERE user_id::text = $1::text
            AND template_slug = $2
            AND UPPER(COALESCE(deal_type, 'BUY')) = 'BUY'
          LIMIT 1
        `,
        [userId, templateSlug],
      );
      if (ownedResult.rows?.[0]) {
        return res.redirect(302, `${nextPath}?cart=owned`);
      }

      if (dealType === 'BUY') {
        await db.query(
          `
            DELETE FROM cart_items
            WHERE user_id::text = $1::text
              AND template_slug = $2
              AND UPPER(deal_type) = 'RENT'
          `,
          [userId, templateSlug],
        );
      }

      if (dealType === 'RENT') {
        const buyCartResult = await db.query(
          `
            SELECT 1
            FROM cart_items
            WHERE user_id::text = $1::text
              AND template_slug = $2
              AND UPPER(deal_type) = 'BUY'
            LIMIT 1
          `,
          [userId, templateSlug],
        );

        if (buyCartResult.rows?.[0]) {
          return res.redirect(302, `${nextPath}?cart=buy_already_in_cart`);
        }
      }

      const cartHasCaseIds = await hasColumn(db, 'cart_items', 'case_ids');
      let insertResult;

      if (cartHasCaseIds) {
        insertResult = await db.query(
          `
            INSERT INTO cart_items (user_id, template_slug, deal_type, license, case_ids, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (user_id, template_slug, deal_type, license) DO UPDATE
              SET case_ids = EXCLUDED.case_ids,
                  updated_at = NOW()
            RETURNING id
          `,
          [
            userId,
            templateSlug,
            dealType,
            license,
            dealType === 'RENT' && caseIds.length ? JSON.stringify(caseIds) : null,
          ],
        );
      } else {
        // Backward-compatible fallback before the migration is applied.
        insertResult = await db.query(
          `
            INSERT INTO cart_items (user_id, template_slug, deal_type, license, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (user_id, template_slug, deal_type, license) DO NOTHING
            RETURNING id
          `,
          [userId, templateSlug, dealType, license],
        );
      }

      if (!insertResult.rows?.[0]) {
        return res.redirect(302, '/cart?exists=1');
      }

      return res.redirect(302, `/cart?added=${encodeURIComponent(templateSlug)}`);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/checkout-all', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return redirectToLogin(res, '/cart');

      const db = req.app.locals?.db;
      if (!db || typeof db.query !== 'function') {
        throw new Error('DB_NOT_CONFIGURED');
      }

      const result = await checkoutAllCartItems(req, db, userId);
      const { purchased, alreadySold, skippedRent, failed } = result;

      const purchasedHtml = purchased.length
        ? `<ul>${purchased
            .map(
              (p) =>
                `<li><strong>${escapeHtml(p.title)}</strong> — <a class="c-btn c-btn--primary" href="/downloads/${encodeURIComponent(p.slug)}">Download ZIP</a></li>`,
            )
            .join('')}</ul>`
        : '<p>No items were purchased.</p>';

      const alreadySoldHtml = alreadySold.length
        ? `<p>Already sold by someone else (removed from your cart): ${escapeHtml(alreadySold.join(', '))}</p>`
        : '';

      const skippedRentHtml = skippedRent.length
        ? `<p>RENT items are not yet supported by bulk checkout — still in your cart, check out individually: ${escapeHtml(skippedRent.join(', '))}</p>`
        : '';

      const failedHtml = failed.length
        ? `<p>Could not process (still in your cart, you can retry): ${escapeHtml(
            failed.map((f) => `${f.slug} (${f.reason})`).join(', '),
          )}</p>`
        : '';

      return renderStandalonePage(req, res, {
        title: 'Checkout complete — Tempasi',
        bodyHtml: `
          <h1>✅ Checkout complete</h1>
          <p>${purchased.length} item(s) purchased.</p>
          ${purchasedHtml}
          ${alreadySoldHtml}
          ${skippedRentHtml}
          ${failedHtml}
          <p><a class="c-btn" href="/cart">Back to cart</a> <a class="c-btn c-btn--primary" href="/templates">Back to catalog</a></p>
        `,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/demo-checkout', async (req, res, next) => {
    try {
      if (!demoCheckoutEnabled()) return res.status(404).send('Not found');

      const userId = getUserId(req);
      if (!userId) return redirectToLogin(res, '/cart');

      const db = req.app.locals?.db;
      if (!db || typeof db.query !== 'function') {
        throw new Error('DB_NOT_CONFIGURED');
      }

      await db.query('BEGIN');
      try {
        const result = await demoCompleteCartCheckout(db, userId);
        await db.query('COMMIT');
        return res.redirect(302, result.redirectTo);
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    } catch (err) {
      return next(err);
    }
  });

  router.post('/remove', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return redirectToLogin(res, '/cart');

      const itemId = Number(req.body?.item_id);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.redirect(302, '/cart');
      }

      const db = req.app.locals?.db;
      if (!db || typeof db.query !== 'function') {
        throw new Error('DB_NOT_CONFIGURED');
      }

      await db.query(
        `
          DELETE FROM cart_items
          WHERE id = $1
            AND user_id::text = $2::text
        `,
        [itemId, userId],
      );

      return res.redirect(302, '/cart?removed=1');
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default { createCartRouter };
