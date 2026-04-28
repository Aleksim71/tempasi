# path: apply_step_5d_zero_pay_v2.py
from pathlib import Path
import shutil
from datetime import datetime

ROOT = Path("/home/aleksim/tempasi")
orders_service = ROOT / "src/modules/orders/orders.service.cjs"

if not orders_service.exists():
    raise SystemExit(f"ERROR: file not found: {orders_service}")

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup_dir = ROOT / "outbox" / f"backup_step_5d_zero_pay_v2_{stamp}"
backup_dir.mkdir(parents=True, exist_ok=True)

backup_file = backup_dir / orders_service.relative_to(ROOT)
backup_file.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(orders_service, backup_file)

print(f"BACKUP: {backup_file}")

t = orders_service.read_text(encoding="utf-8")

# ------------------------------------------------------------
# 1) Add payment completion service import
# ------------------------------------------------------------
if "PaymentCompletionService" not in t:
    marker = "const CheckoutCreditsService = require('../payments/checkoutCredits.service.cjs');"
    replacement = marker + "\nconst PaymentCompletionService = require('../payments/paymentCompletion.service.cjs');"
    if marker not in t:
        raise SystemExit("ERROR: CheckoutCreditsService import marker not found")
    t = t.replace(marker, replacement, 1)
    print("PATCHED: added PaymentCompletionService import")
else:
    print("SKIP: PaymentCompletionService import already present")

# ------------------------------------------------------------
# 2) Insert zero-pay flow before provider checkout session creation
# ------------------------------------------------------------
if "TEMPASI_STEP_5D_ZERO_PAY_FLOW" in t:
    print("SKIP: zero-pay flow already present")
else:
    needle = """  let session;
  try {
    session = await paymentsService.createCheckoutSession(req, { order: checkoutOrder });
"""
    if needle not in t:
        raise SystemExit("ERROR: exact checkout session block not found")

    zero_pay_block = """  // TEMPASI_STEP_5D_ZERO_PAY_FLOW
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

"""
    t = t.replace(needle, zero_pay_block + needle, 1)
    print("PATCHED: inserted Step 5D zero-pay flow")

orders_service.write_text(t, encoding="utf-8")
print("DONE: src/modules/orders/orders.service.cjs updated")
