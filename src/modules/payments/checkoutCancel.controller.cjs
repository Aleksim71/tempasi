// path: src/modules/payments/checkoutCancel.controller.cjs
const db = require("../../config/db.cjs");
const OrdersRepo = require("../orders/orders.repo.cjs");
const CheckoutCreditsService = require("./checkoutCredits.service.cjs");

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

function renderCancelPage({ sessionId, result }) {
  const title = "Checkout cancelled";
  const reason = result && result.reason ? result.reason : "unknown";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f7f8;
      color: #171717;
    }
    main {
      max-width: 720px;
      margin: 64px auto;
      padding: 32px;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 20px;
      box-shadow: 0 12px 40px rgba(0,0,0,.06);
    }
    h1 { margin-top: 0; }
    p { line-height: 1.55; }
    code {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 8px;
      background: #f0f0f0;
      font-size: 12px;
    }
    a {
      display: inline-block;
      margin-top: 16px;
      color: #111827;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>Your checkout was cancelled. If Tempasi credit was reserved for this checkout, it has been released back to your account.</p>
    <p>Status: <code>${escapeHtml(reason)}</code></p>
    <p>Session: <code>${escapeHtml(sessionId || "")}</code></p>
    <a href="/templates">Back to templates</a>
  </main>
</body>
</html>`;
}

async function handleCheckoutCancel(req, res, next) {
  try {
    const sessionId = req.query.session_id || req.query.sessionId || "";
    const result = await releaseReservedCreditByProviderSessionId(sessionId);

    return res
      .status(200)
      .type("html")
      .send(renderCancelPage({ sessionId, result }));
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
