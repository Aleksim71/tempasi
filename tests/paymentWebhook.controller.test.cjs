/* eslint-env jest, node */
'use strict';

const request = require('supertest');
const express = require('express');

const { migrateDb } = require('./helpers/migrateDb.cjs');
const db = require('../src/config/db.cjs');
const PaymentsWebhookController = require('../src/modules/payments/webhook.controller.cjs');

async function query(sql, params = []) {
  if (db && typeof db.query === 'function') {
    return db.query(sql, params);
  }

  if (db && db.pool && typeof db.pool.query === 'function') {
    return db.pool.query(sql, params);
  }

  if (db && db.default && typeof db.default.query === 'function') {
    return db.default.query(sql, params);
  }

  throw new Error('DB_QUERY_NOT_AVAILABLE');
}

async function closeDb() {
  if (db && typeof db.end === 'function') {
    await db.end();
    return;
  }

  if (db && db.pool && typeof db.pool.end === 'function') {
    await db.pool.end();
    return;
  }

  if (db && db.default && typeof db.default.end === 'function') {
    await db.default.end();
  }
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.post('/webhook', PaymentsWebhookController.webhook);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({
      ok: false,
      error: err.code || err.message,
    });
  });
  return app;
}

async function seedPendingOrder({ userId, slug, sessionId, dealType = 'BUY' }) {
  const result = await query(
    `
      INSERT INTO public.orders (
        user_id,
        template_slug,
        deal_type,
        license,
        amount_cents,
        currency,
        provider,
        provider_session_id,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'PU', 1000, 'EUR', 'fake', $4, 'pending', NOW(), NOW())
      RETURNING *
    `,
    [userId, slug, dealType, sessionId]
  );

  return result.rows[0];
}

describe('payments webhook controller', () => {
  beforeEach(async () => {
    await migrateDb();
    await query('DELETE FROM public.entitlements');
    await query('DELETE FROM public.orders');
  });

  afterAll(async () => {
    await closeDb();
  });

  test('fake checkout.session.completed uses canonical completion and creates entitlement', async () => {
    const app = createApp();
    const sessionId = `fake_webhook_${Date.now()}`;
    const order = await seedPendingOrder({
      userId: 777,
      slug: 'webhook-buy-template',
      sessionId,
      dealType: 'BUY',
    });

    const res = await request(app)
      .post('/webhook')
      .send({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: sessionId,
            payment_intent: 'pi_fake_webhook',
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      orderId: order.id,
    });

    const paidResult = await query(
      `SELECT status, provider_payment_intent_id FROM public.orders WHERE id = $1`,
      [order.id]
    );
    expect(paidResult.rows[0].status).toBe('paid');
    expect(paidResult.rows[0].provider_payment_intent_id).toBe('pi_fake_webhook');

    const entitlementResult = await query(
      `
        SELECT user_id, template_slug, kind, deal_type, order_id
        FROM public.entitlements
        WHERE order_id = $1
      `,
      [order.id]
    );

    expect(entitlementResult.rows).toHaveLength(1);
    expect(String(entitlementResult.rows[0].user_id)).toBe('777');
    expect(entitlementResult.rows[0]).toMatchObject({
      template_slug: 'webhook-buy-template',
      kind: 'buy',
      deal_type: 'BUY',
      order_id: order.id,
    });
  });

  test('duplicate fake webhook is idempotent', async () => {
    const app = createApp();
    const sessionId = `fake_webhook_dup_${Date.now()}`;
    const order = await seedPendingOrder({
      userId: 778,
      slug: 'webhook-idempotent-template',
      sessionId,
      dealType: 'BUY',
    });

    for (let i = 0; i < 2; i += 1) {
      const res = await request(app)
        .post('/webhook')
        .send({
          type: 'checkout.session.completed',
          data: {
            object: {
              id: sessionId,
              payment_intent: 'pi_fake_webhook_dup',
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.orderId).toBe(order.id);
    }

    const entitlementResult = await query(
      `SELECT COUNT(*)::int AS count FROM public.entitlements WHERE order_id = $1`,
      [order.id]
    );

    expect(entitlementResult.rows[0].count).toBe(1);
  });

  test('fake checkout.session.expired releases reserved checkout credit', async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    process.env.PAYMENTS_PROVIDER = 'fake';
    process.env.APP_BASE_URL = 'http://localhost:3000';

    const app = createApp();
    const ordersService = require('../src/modules/orders/orders.service.cjs');

    const userResult = await query(
      `
        INSERT INTO public.users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id
      `,
      [`webhook-expired-credit-${Date.now()}@example.com`, 'test-password-hash']
    );

    const userId = userResult.rows[0].id;
    const templateSlug = `webhook-expired-credit-template-${Date.now()}`;

    await query(
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
      [userId]
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

    const beforeRelease = await query(
      `
        SELECT status, amount_cents
          FROM public.account_credit_usages
         WHERE order_id = $1
      `,
      [checkout.orderId]
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

    const afterRelease = await query(
      `
        SELECT status, amount_cents
          FROM public.account_credit_usages
         WHERE order_id = $1
      `,
      [checkout.orderId]
    );

    expect(afterRelease.rows).toHaveLength(1);
    expect(afterRelease.rows[0].status).toBe('released');
    expect(Number(afterRelease.rows[0].amount_cents)).toBe(350);

    const orderResult = await query(
      `
        SELECT status
          FROM public.orders
         WHERE id = $1
      `,
      [checkout.orderId]
    );

    expect(orderResult.rows).toHaveLength(1);
    expect(orderResult.rows[0].status).toBe('failed');
  });

});
