# path: apply_step_5e_zero_pay_integration_test.py
from pathlib import Path
import shutil
from datetime import datetime

ROOT = Path("/home/aleksim/tempasi")
test_file = ROOT / "tests/checkoutCredits.integration.test.cjs"

if not test_file.exists():
    raise SystemExit(f"ERROR: file not found: {test_file}")

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup_dir = ROOT / "outbox" / f"backup_step_5e_zero_pay_test_{stamp}"
backup_dir.mkdir(parents=True, exist_ok=True)

backup_file = backup_dir / test_file.relative_to(ROOT)
backup_file.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(test_file, backup_file)

print(f"BACKUP: {backup_file}")

t = test_file.read_text(encoding="utf-8")

if "full account credit cover completes checkout internally without external provider session" in t:
    print("SKIP: Step 5E zero-pay integration test already present")
else:
    insert_before = "\n});\n"
    idx = t.rfind(insert_before)
    if idx == -1:
        raise SystemExit("ERROR: could not find describe closing block")

    test_block = r'''
  test('full account credit cover completes checkout internally without external provider session', async () => {
    await withDb(async (db) => {
      jest.resetModules();

      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
      process.env.PAYMENTS_PROVIDER = 'fake';
      process.env.APP_BASE_URL = 'http://localhost:3000';

      const ordersService = require('../src/modules/orders/orders.service.cjs');

      const userResult = await db.query(
        `
        INSERT INTO public.users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id
        `,
        [`zero-pay-credit-${Date.now()}@example.com`, 'test-password-hash'],
      );

      const userId = userResult.rows[0].id;
      const templateSlug = `zero-pay-template-${Date.now()}`;

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
        VALUES ($1, 'test_zero_pay_credit_checkout', NULL, NULL, 1000, 'EUR', 'active', now() + interval '90 days')
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

      expect(checkout.zeroPay).toBe(true);
      expect(checkout.sessionId).toContain('internal_credit_zero_pay:');
      expect(checkout.checkoutUrl).toContain('source=internal_credit_zero_pay');
      expect(checkout.checkoutUrl).not.toContain('payable_amount_cents=');
      expect(checkout.grossAmountCents).toBe(1000);
      expect(checkout.creditAppliedCents).toBe(1000);
      expect(checkout.payableAmountCents).toBe(0);

      const orderResult = await db.query(
        `
        SELECT id, status, provider_session_id, provider_payment_intent_id,
               gross_amount_cents, credit_applied_cents, payable_amount_cents
          FROM public.orders
         WHERE id = $1
        `,
        [checkout.orderId],
      );

      expect(orderResult.rows).toHaveLength(1);
      expect(orderResult.rows[0].status).toBe('paid');
      expect(orderResult.rows[0].provider_session_id).toContain('internal_credit_zero_pay:');
      expect(orderResult.rows[0].provider_payment_intent_id).toContain('internal_credit_zero_pay:');
      expect(Number(orderResult.rows[0].gross_amount_cents)).toBe(1000);
      expect(Number(orderResult.rows[0].credit_applied_cents)).toBe(1000);
      expect(Number(orderResult.rows[0].payable_amount_cents)).toBe(0);

      const usageResult = await db.query(
        `
        SELECT status, amount_cents
          FROM public.account_credit_usages
         WHERE order_id = $1
        `,
        [checkout.orderId],
      );

      expect(usageResult.rows).toHaveLength(1);
      expect(usageResult.rows[0].status).toBe('applied');
      expect(Number(usageResult.rows[0].amount_cents)).toBe(1000);

      const entitlementResult = await db.query(
        `
        SELECT id, order_id, user_id, template_slug, deal_type, status
          FROM public.entitlements
         WHERE order_id = $1
        `,
        [checkout.orderId],
      );

      expect(entitlementResult.rows).toHaveLength(1);
      expect(entitlementResult.rows[0].user_id).toBe(userId);
      expect(entitlementResult.rows[0].template_slug).toBe(templateSlug);
      expect(String(entitlementResult.rows[0].deal_type).toUpperCase()).toBe('BUY');
      expect(entitlementResult.rows[0].status).toBe('active');
    });
  });
'''

    t = t[:idx] + "\n" + test_block + t[idx:]
    test_file.write_text(t, encoding="utf-8")
    print("PATCHED: tests/checkoutCredits.integration.test.cjs")

print("DONE: Step 5E integration test patch applied")
