# path: apply_step_5f_release_reserved_credit_webhook.py
from pathlib import Path
import shutil
from datetime import datetime

ROOT = Path("/home/aleksim/tempasi")

webhook_file = ROOT / "src/modules/payments/webhook.controller.cjs"
test_file = ROOT / "tests/paymentWebhook.controller.test.cjs"

for p in [webhook_file, test_file]:
    if not p.exists():
        raise SystemExit(f"ERROR: file not found: {p}")

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup_dir = ROOT / "outbox" / f"backup_step_5f_release_credit_{stamp}"
backup_dir.mkdir(parents=True, exist_ok=True)

for p in [webhook_file, test_file]:
    dst = backup_dir / p.relative_to(ROOT)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dst)

print(f"BACKUP: {backup_dir}")

# ------------------------------------------------------------
# 1) PATCH webhook.controller.cjs
# ------------------------------------------------------------
t = webhook_file.read_text(encoding="utf-8")

if "TEMPASI_STEP_5F_RELEASE_RESERVED_CREDIT" in t:
    print("SKIP: webhook controller already has Step 5F marker")
else:
    # Add imports
    marker = "const PaymentCompletion = require('./paymentCompletion.service.cjs');"
    replacement = (
        marker
        + "\nconst OrdersRepo = require('../orders/orders.repo.cjs');"
        + "\nconst CheckoutCreditsService = require('./checkoutCredits.service.cjs');"
        + "\nconst db = require('../../config/db.cjs');"
    )
    if marker not in t:
        raise SystemExit("ERROR: PaymentCompletion import marker not found")
    t = t.replace(marker, replacement, 1)

    # Add helper after config import block
    helper_marker = "const { PAYMENTS_PROVIDER, STRIPE_WEBHOOK_SECRET } = require('../../config/payments.cjs');\n"
    helper = r"""
// TEMPASI_STEP_5F_RELEASE_RESERVED_CREDIT
const RELEASE_RESERVED_CREDIT_EVENT_TYPES = new Set([
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
]);

async function releaseReservedCreditByProviderSessionId(providerSessionId) {
  if (!providerSessionId) {
    const err = new Error('PROVIDER_SESSION_ID_REQUIRED');
    err.status = 400;
    throw err;
  }

  const order = await OrdersRepo.findOrderByProviderSessionId(providerSessionId);
  if (!order) {
    return {
      ok: true,
      released: false,
      orderId: null,
      reason: 'ORDER_NOT_FOUND_FOR_PROVIDER_SESSION',
    };
  }

  const releasedCredits = await CheckoutCreditsService.releaseReservedCreditForOrder(db, order.id);

  let failedOrder = order;
  if (String(order.status || '').toLowerCase() === 'pending' && typeof OrdersRepo.markOrderFailed === 'function') {
    failedOrder = await OrdersRepo.markOrderFailed({ orderId: order.id }) || order;
  }

  return {
    ok: true,
    released: true,
    orderId: order.id,
    orderStatus: failedOrder?.status || order.status || null,
    releasedCredits,
  };
}

"""
    if helper_marker not in t:
        raise SystemExit("ERROR: config import marker not found")
    t = t.replace(helper_marker, helper_marker + helper, 1)

    # Patch Stripe handler
    old_stripe = """  // We care about checkout.session.completed (paid)
  if (event.type !== 'checkout.session.completed') return { ok: true };

  const session = event.data.object;
  const sessionId = session.id;

  const completed = await PaymentCompletion.completePaidOrder({
    providerSessionId: sessionId,
    providerPaymentIntentId: session.payment_intent || null,
  });

  return {
    ok: true,
    orderId: completed?.order?.id || null,
  };
"""
    new_stripe = """  const session = event.data.object;
  const sessionId = session.id;

  if (event.type === 'checkout.session.completed') {
    const completed = await PaymentCompletion.completePaidOrder({
      providerSessionId: sessionId,
      providerPaymentIntentId: session.payment_intent || null,
    });

    return {
      ok: true,
      orderId: completed?.order?.id || null,
    };
  }

  if (RELEASE_RESERVED_CREDIT_EVENT_TYPES.has(event.type)) {
    return releaseReservedCreditByProviderSessionId(sessionId);
  }

  return { ok: true };
"""
    if old_stripe not in t:
        raise SystemExit("ERROR: expected Stripe completion block not found")
    t = t.replace(old_stripe, new_stripe, 1)

    # Patch fake handler
    old_fake = """  if (type !== 'checkout.session.completed' || !sessionId) {
    const err = new Error('INVALID_FAKE_WEBHOOK_PAYLOAD');
    err.status = 400;
    throw err;
  }

  const completed = await PaymentCompletion.completePaidOrder({
    providerSessionId: sessionId,
    providerPaymentIntentId: body?.data?.object?.payment_intent || 'pi_fake',
  });

  return {
    ok: true,
    orderId: completed?.order?.id || null,
  };
"""
    new_fake = """  if (!sessionId) {
    const err = new Error('INVALID_FAKE_WEBHOOK_PAYLOAD');
    err.status = 400;
    throw err;
  }

  if (type === 'checkout.session.completed') {
    const completed = await PaymentCompletion.completePaidOrder({
      providerSessionId: sessionId,
      providerPaymentIntentId: body?.data?.object?.payment_intent || 'pi_fake',
    });

    return {
      ok: true,
      orderId: completed?.order?.id || null,
    };
  }

  if (RELEASE_RESERVED_CREDIT_EVENT_TYPES.has(type)) {
    return releaseReservedCreditByProviderSessionId(sessionId);
  }

  const err = new Error('INVALID_FAKE_WEBHOOK_PAYLOAD');
  err.status = 400;
  throw err;
"""
    if old_fake not in t:
        raise SystemExit("ERROR: expected Fake webhook validation block not found")
    t = t.replace(old_fake, new_fake, 1)

    webhook_file.write_text(t, encoding="utf-8")
    print("PATCHED: src/modules/payments/webhook.controller.cjs")

# ------------------------------------------------------------
# 2) PATCH paymentWebhook.controller.test.cjs
# ------------------------------------------------------------
tt = test_file.read_text(encoding="utf-8")

if "fake checkout.session.expired releases reserved checkout credit" in tt:
    print("SKIP: Step 5F webhook release test already present")
else:
    insert_before = "\n});\n"
    idx = tt.rfind(insert_before)
    if idx == -1:
        raise SystemExit("ERROR: could not find describe closing block in paymentWebhook.controller.test.cjs")

    test_block = r'''
  test('fake checkout.session.expired releases reserved checkout credit', async () => {
    await withDb(async (db) => {
      jest.resetModules();

      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
      process.env.PAYMENTS_PROVIDER = 'fake';
      process.env.APP_BASE_URL = 'http://localhost:3000';

      const app = express();
      app.use(express.json());
      const PaymentsWebhookController = require('../src/modules/payments/webhook.controller.cjs');
      app.post('/webhook', PaymentsWebhookController.webhook);

      const ordersService = require('../src/modules/orders/orders.service.cjs');

      const userResult = await db.query(
        `
        INSERT INTO public.users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id
        `,
        [`webhook-expired-credit-${Date.now()}@example.com`, 'test-password-hash'],
      );

      const userId = userResult.rows[0].id;
      const templateSlug = `webhook-expired-credit-template-${Date.now()}`;

      await db.query(
        `
        INSERT INTO public.account_credits (
          user_id,
          source_type,
          source_order_id,
          related_order_id,
          amount_cents,
          currency,
          status,
          expires_at
        )
        VALUES ($1, 'test_webhook_expired_credit', NULL, NULL, 350, 'EUR', 'active', now() + interval '90 days')
        `,
        [userId],
      );

      const checkout = await ordersService.createOrderCheckout(null, {
        userId,
        templateSlug,
        payload: {
          dealType: 'BUY',
          license: 'EX',
          amountCents: 1000,
          currency: 'EUR',
        },
      });

      expect(checkout.payableAmountCents).toBe(650);
      expect(checkout.checkoutUrl).toContain('payable_amount_cents=650');

      const beforeRelease = await db.query(
        `
        SELECT status, amount_cents
          FROM public.account_credit_usages
         WHERE order_id = $1
        `,
        [checkout.orderId],
      );

      expect(beforeRelease.rows).toHaveLength(1);
      expect(beforeRelease.rows[0].status).toBe('reserved');
      expect(Number(beforeRelease.rows[0].amount_cents)).toBe(350);

      const res = await request(app)
        .post('/webhook')
        .send({
          type: 'checkout.session.expired',
          data: {
            object: {
              id: checkout.sessionId,
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.released).toBe(true);
      expect(String(res.body.orderId)).toBe(String(checkout.orderId));

      const afterRelease = await db.query(
        `
        SELECT status, amount_cents
          FROM public.account_credit_usages
         WHERE order_id = $1
        `,
        [checkout.orderId],
      );

      expect(afterRelease.rows).toHaveLength(1);
      expect(afterRelease.rows[0].status).toBe('released');
      expect(Number(afterRelease.rows[0].amount_cents)).toBe(350);

      const orderResult = await db.query(
        `
        SELECT status
          FROM public.orders
         WHERE id = $1
        `,
        [checkout.orderId],
      );

      expect(orderResult.rows).toHaveLength(1);
      expect(orderResult.rows[0].status).toBe('failed');
    });
  });
'''
    tt = tt[:idx] + "\n" + test_block + tt[idx:]
    test_file.write_text(tt, encoding="utf-8")
    print("PATCHED: tests/paymentWebhook.controller.test.cjs")

print("DONE: Step 5F patch applied")
