// src/modules/orders/orders.service.cjs
'use strict';

const ordersRepo = require('./orders.repo.cjs');
const paymentsService = require('../payments/payments.service.cjs');
const CheckoutCreditsService = require('../payments/checkoutCredits.service.cjs');
const PaymentCompletionService = require('../payments/paymentCompletion.service.cjs');
const db = require('../../config/db.cjs');
const casesService = require('../cases/cases.service.cjs');

const LICENSE_DEFAULTS = {
  PU: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  CU: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  EL: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  ML: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  EX: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
};

function fail(code, status, message = code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  throw err;
}

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function collectCaseIds(payload = {}) {
  const raw = [];
  const keys = ['caseIds', 'case_ids', 'cases', 'selectedCaseIds', 'selected_case_ids'];

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) raw.push(...value);
    else if (value !== undefined && value !== null) raw.push(value);
  }

  const out = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      out.push(...item);
      continue;
    }

    const text = String(item || '').trim();
    if (!text) continue;

    if (text.includes(',')) {
      out.push(...text.split(',').map((part) => part.trim()).filter(Boolean));
      continue;
    }

    out.push(text);
  }

  return [...new Set(out.map((id) => String(id || '').trim()).filter(Boolean))];
}

function normalizeBuyPayload(payload = {}) {
  const license = String(payload.license || 'PU').trim().toUpperCase();
  const fallback = LICENSE_DEFAULTS[license];
  if (!fallback) {
    fail('INVALID_LICENSE', 400);
  }

  const amountCents =
    Number.isFinite(Number(payload.amountCents)) ? Number(payload.amountCents) :
    Number.isFinite(Number(payload.amount)) ? Math.round(Number(payload.amount) * 100) :
    fallback.amountCents;

  const dealType = String(payload.dealType || payload.deal_type || fallback.dealType || 'BUY')
    .trim()
    .toUpperCase();

  const rentDays = parsePositiveInt(
    payload.rentDays ?? payload.rent_days ?? payload.rentalDays ?? payload.days
  );

  const caseIds = collectCaseIds(payload);

  return {
    license,
    amountCents,
    currency: String(payload.currency || fallback.currency || 'EUR').trim().toUpperCase(),
    dealType,
    rentDays,
    caseIds,
  };
}

async function validateRentSelection({ userId, payload }) {
  if (payload.dealType !== 'RENT') return payload;

  if (!payload.rentDays) {
    fail('RENT_DAYS_REQUIRED', 400, 'Select rental period before payment.');
  }

  if (payload.rentDays < 1 || payload.rentDays > 365) {
    fail('RENT_DAYS_INVALID', 400, 'Rental period must be between 1 and 365 days.');
  }

  if (!payload.caseIds || payload.caseIds.length === 0) {
    fail('RENT_CASE_IDS_REQUIRED', 400, 'Select at least one Case for this rent.');
  }

  await casesService.ensureDefaultCaseForUser(userId);

  const ownedCaseIds = await casesService.listOwnedCaseIds(userId, payload.caseIds);
  const ownedSet = new Set(ownedCaseIds.map(String));
  const missing = payload.caseIds.filter((id) => !ownedSet.has(String(id)));

  if (missing.length > 0) {
    fail('RENT_CASE_NOT_OWNED', 403, 'Selected Case does not belong to current user.');
  }

  return payload;
}

async function createPendingOrder({ userId, templateSlug, payload }) {
  if (!userId) {
    fail('USER_ID_REQUIRED', 400);
  }

  if (!templateSlug) {
    fail('TEMPLATE_SLUG_REQUIRED', 400);
  }

  const p = await validateRentSelection({
    userId,
    payload: normalizeBuyPayload(payload),
  });

  // TEMPASI_STEP_6D_BUY_EXCLUSIVITY_GUARD
  // A completed BUY is permanent exclusivity: no later BUY or RENT checkout may be created.
  const alreadySold = await ordersRepo.hasPaidBuyByTemplateSlug(templateSlug);
  if (alreadySold) {
    fail('TEMPLATE_ALREADY_SOLD', 409, 'Template already sold (exclusive sale).');
  }

  if (p.dealType === 'BUY') {
    const activeRent = await ordersRepo.findActiveRentReservationByTemplateSlug(templateSlug);
    if (activeRent && String(activeRent.user_id) !== String(userId)) {
      fail('TEMPLATE_RENT_RESERVED', 409, 'Template is currently reserved by active rent.');
    }
  }

  const order = await ordersRepo.createOrder({
    userId,
    templateSlug,
    dealType: p.dealType,
    license: p.license,
    amountCents: p.amountCents,
    currency: p.currency,
    provider: 'fake',
    rentDays: p.dealType === 'RENT' ? p.rentDays : null,
    caseIds: p.dealType === 'RENT' ? p.caseIds : [],
  });

  return order;
}

async function createOrderCheckout(req, { userId, templateSlug, payload }) {
  const order = await createPendingOrder({ userId, templateSlug, payload });

  const grossAmountCents = Number(
    order.amount_cents ?? order.amountCents ?? p?.amountCents ?? payload?.amountCents ?? 0
  );

  const creditReservation = await CheckoutCreditsService.reserveCreditForOrder(db, {
    userId: order.user_id || order.userId || userId,
    orderId: order.id,
    grossAmountCents,
  });

  const checkoutOrder = {
    ...order,
    amount_cents: grossAmountCents,
    gross_amount_cents: creditReservation.grossAmountCents,
    credit_applied_cents: creditReservation.creditAppliedCents,
    payable_amount_cents: creditReservation.payableAmountCents,
  };

  // TEMPASI_STEP_5D_ZERO_PAY_FLOW
  // If internal Tempasi credit fully covers checkout, do not create an external provider session.
  // Complete the order internally and consume the reserved credit through the normal payment completion path.
  if (Number(creditReservation.payableAmountCents ?? checkoutOrder.payable_amount_cents ?? 0) === 0) {
    if (!PaymentCompletionService || typeof PaymentCompletionService.completePaidOrder !== 'function') {
      await CheckoutCreditsService.releaseReservedCreditForOrder(db, order.id);
      fail('ZERO_PAY_COMPLETION_SERVICE_UNAVAILABLE', 500);
    }

    const providerSessionId = `internal_credit_zero_pay:${order.id}`;
    const providerPaymentIntentId = `internal_credit_zero_pay:${order.id}`;

    await ordersRepo.attachProviderSession({
      orderId: order.id,
      providerSessionId,
    });

    const completion = await PaymentCompletionService.completePaidOrder({
      orderId: order.id,
      providerSessionId,
      providerPaymentIntentId,
      provider: 'internal_credit',
    });

    return {
      orderId: order.id,
      sessionId: providerSessionId,
      checkoutUrl: `/checkout/success?order_id=${encodeURIComponent(order.id)}&source=internal_credit_zero_pay`,
      grossAmountCents: creditReservation.grossAmountCents,
      creditAppliedCents: creditReservation.creditAppliedCents,
      payableAmountCents: creditReservation.payableAmountCents,
      zeroPay: true,
      completion,
    };
  }

  let session;
  try {
    session = await paymentsService.createCheckoutSession(req, { order: checkoutOrder });
  } catch (error) {
    await CheckoutCreditsService.releaseReservedCreditForOrder(db, order.id);
    throw error;
  }

  if (!session || !session.id || !session.url) {
    await CheckoutCreditsService.releaseReservedCreditForOrder(db, order.id);
    fail('CHECKOUT_SESSION_CREATE_FAILED', 500);
  }

  await ordersRepo.attachProviderSession({
    orderId: order.id,
    providerSessionId: session.id,
  });

  return {
    orderId: order.id,
    sessionId: session.id,
    checkoutUrl: session.url,
    grossAmountCents: creditReservation.grossAmountCents,
    creditAppliedCents: creditReservation.creditAppliedCents,
    payableAmountCents: creditReservation.payableAmountCents,
  };
}

module.exports = {
  normalizeBuyPayload,
  createPendingOrder,
  createOrderCheckout,
};
