// path: tests/rentExpiration.integration.test.cjs
/* eslint-env node */
'use strict';

// Canonical repos use src/config/db.cjs and read DATABASE_URL.
// DB integration tests run against DATABASE_URL_TEST.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const { migrateDb } = require('./helpers/migrateDb.cjs');
const { withDb } = require('./helpers/db.cjs');
const { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');

function uniqueSlug(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createUser(db, prefix) {
  const result = await db.query(
    `
    INSERT INTO public.users (email, password_hash)
    VALUES ($1, $2)
    RETURNING id
    `,
    [`${prefix}.${Date.now()}.${Math.random().toString(16).slice(2)}@tempasi.test`, 'test-password-hash'],
  );

  return result.rows[0].id;
}

async function createPublishedTemplate(db, { ownerUserId, slug }) {
  const result = await db.query(
    `
    INSERT INTO public.seller_templates (
      owner_user_id,
      title,
      slug,
      short_description,
      description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path
    )
    VALUES ($1, $2, $3, $4, $5, 25000, 2500, 'published', $6)
    RETURNING *
    `,
    [
      ownerUserId,
      'Step 5Z Rent Expiration Template',
      slug,
      'Template used by Step 5Z rent expiration integration test.',
      'Template used by Step 5Z rent expiration integration test.',
      `/tmp/${slug}.zip`,
    ],
  );

  return result.rows[0];
}

async function createPaidOrder(db, { userId, templateSlug, dealType, rentDays = null }) {
  const result = await db.query(
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
      provider_payment_intent_id,
      status,
      rent_days
    )
    VALUES ($1, $2, $3, $4, $5, 'EUR', 'fake', $6, $7, 'paid', $8)
    RETURNING *
    `,
    [
      userId,
      templateSlug,
      dealType,
      dealType === 'RENT' ? 'PU' : 'EX',
      dealType === 'RENT' ? 2500 : 25000,
      `sess_step5z_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      `pi_step5z_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      rentDays,
    ],
  );

  return result.rows[0];
}

async function createEntitlement(db, { userId, templateSlug, orderId, dealType, endsAtSql }) {
  const result = await db.query(
    `
    INSERT INTO public.entitlements (
      user_id,
      template_slug,
      kind,
      deal_type,
      order_id,
      starts_at,
      ends_at,
      created_at,
      updated_at
    )
    VALUES (
      $1,
      $2,
      LOWER($3),
      $3,
      $4,
      now() - interval '1 hour',
      ${endsAtSql},
      now(),
      now()
    )
    RETURNING *
    `,
    [userId, templateSlug, dealType, orderId],
  );

  return result.rows[0];
}

async function catalogSlugs(db, selectTemplatesForCatalog) {
  const rows = await selectTemplatesForCatalog(db);
  return rows.map((row) => row.slug);
}

describe('rent expiration integration flow', () => {
  beforeAll(async () => {
    await migrateDb();
  });

  afterAll(async () => {
    await closeDbAfterTest();
  });

  test('expired RENT returns template to gallery; later BUY removes it permanently', async () => {
    await withDb(async (db) => {
      jest.resetModules();

      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
      process.env.PAYMENTS_PROVIDER = 'fake';
      process.env.APP_BASE_URL = 'http://localhost:3000';

      const catalogRepo = await import('../src/server/catalog/templates.repo.js');
      const ordersRepo = require('../src/modules/orders/orders.repo.cjs');

      const selectTemplatesForCatalog = catalogRepo.selectTemplatesForCatalog;

      const sellerId = await createUser(db, 'step5z-seller');
      const renterUserId = await createUser(db, 'step5z-renter');
      const buyerUserId = await createUser(db, 'step5z-buyer');

      const templateSlug = uniqueSlug('step5z-rent-expiration');
      await createPublishedTemplate(db, { ownerUserId: sellerId, slug: templateSlug });

      expect(await catalogSlugs(db, selectTemplatesForCatalog)).toContain(templateSlug);

      const rentOrder = await createPaidOrder(db, {
        userId: renterUserId,
        templateSlug,
        dealType: 'RENT',
        rentDays: 1,
      });

      const rentEntitlement = await createEntitlement(db, {
        userId: renterUserId,
        templateSlug,
        orderId: rentOrder.id,
        dealType: 'RENT',
        endsAtSql: "now() + interval '1 day'",
      });

      expect(rentEntitlement.closed_at).toBeNull();

      expect(await catalogSlugs(db, selectTemplatesForCatalog)).not.toContain(templateSlug);

      const activeRentReservation = await ordersRepo.findActiveRentReservationByTemplateSlug(templateSlug);
      expect(activeRentReservation).toBeTruthy();
      expect(String(activeRentReservation.template_slug)).toBe(templateSlug);

      await db.query(
        `
        UPDATE public.entitlements
           SET ends_at = now() - interval '1 hour',
               updated_at = now()
         WHERE id = $1
        `,
        [rentEntitlement.id],
      );

      expect(await catalogSlugs(db, selectTemplatesForCatalog)).toContain(templateSlug);

      const expiredRentReservation = await ordersRepo.findActiveRentReservationByTemplateSlug(templateSlug);
      expect(expiredRentReservation).toBeNull();

      const buyerCanCreateBuyOrder = await ordersRepo.createOrder({
        userId: buyerUserId,
        templateSlug,
        dealType: 'BUY',
        license: 'EX',
        amountCents: 25000,
        currency: 'EUR',
        provider: 'fake',
      });

      expect(buyerCanCreateBuyOrder).toBeTruthy();
      expect(String(buyerCanCreateBuyOrder.template_slug)).toBe(templateSlug);
      expect(String(buyerCanCreateBuyOrder.deal_type).toUpperCase()).toBe('BUY');

      await db.query(
        `
        UPDATE public.orders
           SET status = 'paid',
               updated_at = now()
         WHERE id = $1
        `,
        [buyerCanCreateBuyOrder.id],
      );

      await createEntitlement(db, {
        userId: buyerUserId,
        templateSlug,
        orderId: buyerCanCreateBuyOrder.id,
        dealType: 'BUY',
        endsAtSql: 'NULL',
      });

      expect(await catalogSlugs(db, selectTemplatesForCatalog)).not.toContain(templateSlug);

      const oldRentAfterBuy = await db.query(
        `
        SELECT id, closed_at, closed_reason, ends_at
          FROM public.entitlements
         WHERE id = $1
        `,
        [rentEntitlement.id],
      );

      expect(oldRentAfterBuy.rows).toHaveLength(1);
      expect(oldRentAfterBuy.rows[0].closed_at).toBeNull();
      expect(oldRentAfterBuy.rows[0].closed_reason).toBeNull();
      expect(new Date(oldRentAfterBuy.rows[0].ends_at).getTime()).toBeLessThan(Date.now());
    });
  });
});
