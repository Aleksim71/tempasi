// path: src/modules/payments/checkoutCancel.controller.cjs
const db = require("../../config/db.cjs");
const OrdersRepo = require("../orders/orders.repo.cjs");
const CheckoutCreditsService = require("./checkoutCredits.service.cjs");
const { renderStandalonePage } = require("../../web/helpers/renderStandalonePage.cjs");

function getQueryableDbAdapter(candidate) {
  if (candidate && typeof candidate.query === "function") {
    return candidate;
  }

  if (candidate && candidate.pool && typeof candidate.pool.query === "function") {
    return candidate.pool;
  }

  if (candidate && candidate.default && typeof candidate.default.query === "function") {
    return candidate.default;
  }

  if (
    candidate &&
    candidate.default &&
    candidate.default.pool &&
    typeof candidate.default.pool.query === "function"
  ) {
    return candidate.default.pool;
  }

  throw new Error("DB_QUERY_ADAPTER_UNAVAILABLE");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function releaseReservedCreditByProviderSessionId(providerSessionId) {
  if (!providerSessionId) {
    return {
      ok: false,
      reason: "missing_provider_session_id",
      released: false,
      order: null,
      releasedCredits: [],
    };
  }

  const order = await OrdersRepo.findOrderByProviderSessionId(providerSessionId);

  if (!order) {
    return {
      ok: false,
      reason: "order_not_found",
      released: false,
      order: null,
      releasedCredits: [],
    };
  }

  if (order.status !== "pending") {
    return {
      ok: true,
      reason: "order_not_pending",
      released: false,
      order,
      releasedCredits: [],
    };
  }

  const queryableDb = getQueryableDbAdapter(db);
  const releasedCredits = await CheckoutCreditsService.releaseReservedCreditForOrder(queryableDb, order.id);

  const updateResult = await queryableDb.query(
    `
      UPDATE public.orders
      SET status = 'failed',
          updated_at = now()
      WHERE id = $1
        AND status = 'pending'
      RETURNING *
    `,
    [order.id],
  );

  return {
    ok: true,
    reason: "cancelled",
    released: true,
    order: updateResult.rows[0] || order,
    releasedCredits,
  };
}

function renderCancelBodyHtml({ sessionId, result }) {
  const reason = result && result.reason ? result.reason : "unknown";

  return `
    <h1>Checkout cancelled</h1>
    <p>Your checkout was cancelled. If Tempasi credit was reserved for this checkout, it has been released back to your account.</p>
    <p>Status: <code>${escapeHtml(reason)}</code></p>
    <p>Session: <code>${escapeHtml(sessionId || "")}</code></p>
    <p><a class="c-btn c-btn--primary" href="/templates">Back to templates</a></p>
  `;
}

async function handleCheckoutCancel(req, res, next) {
  try {
    const sessionId = req.query.session_id || req.query.sessionId || "";
    const result = await releaseReservedCreditByProviderSessionId(sessionId);

    return renderStandalonePage(req, res, {
      title: "Checkout cancelled — Tempasi",
      bodyHtml: renderCancelBodyHtml({ sessionId, result }),
    });
  } catch (error) {
    if (typeof next === "function") {
      return next(error);
    }

    return res.status(500).json({
      ok: false,
      error: "checkout_cancel_failed",
      message: error.message,
    });
  }
}

module.exports = {
  handleCheckoutCancel,
  releaseReservedCreditByProviderSessionId,
};
