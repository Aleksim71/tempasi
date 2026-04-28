// tests/rentReservation.service.test.cjs
/* eslint-env node */
'use strict';

if (process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const { withDb } = require('./helpers/db.cjs');
const { createTestUser } = require('./helpers/user.cjs');

const OrdersService = require('../src/modules/orders/orders.service.cjs');
const EntitlementsRepo = require('../src/modules/payments/repos/entitlements.repo.cjs');

async function createPaidRentOrder(db, { userId, templateSlug }) {
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
      status
    )
    VALUES ($1, $2, 'RENT', 'PU', 100, 'EUR', 'fake', $3, $4, 'paid')
    RETURNING *
    `,
    [
      userId,
      templateSlug,
      `rent_sess_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      `rent_pi_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ],
  );

  return result.rows[0];
}

describe('rent reservation business rules', () => {
  test('active RENT blocks BUY by another user', async () => {
    await withDb(async (db) => {
      const renterUserId = await createTestUser(db);
      const otherUserId = await createTestUser(db);
      const templateSlug = `rent-reserved-${Date.now()}-1`;

      const rentOrder = await createPaidRentOrder(db, {
        userId: renterUserId,
        templateSlug,
      });

      const entitlement = await EntitlementsRepo.ensureEntitlementForOrder(rentOrder);

      expect(entitlement).toBeTruthy();
      expect(String(entitlement.kind).toLowerCase()).toBe('rent');
      expect(String(entitlement.deal_type).toUpperCase()).toBe('RENT');
      expect(entitlement.ends_at).toBeTruthy();

      await expect(
        OrdersService.createPendingOrder({
          userId: otherUserId,
          templateSlug,
          payload: { license: 'PU', dealType: 'BUY' },
        }),
      ).rejects.toMatchObject({
        code: 'TEMPLATE_RENT_RESERVED',
        status: 409,
      });
    });
  });

  test('active RENT allows BUY by the current renter', async () => {
    await withDb(async (db) => {
      const renterUserId = await createTestUser(db);
      const templateSlug = `rent-reserved-${Date.now()}-2`;

      const rentOrder = await createPaidRentOrder(db, {
        userId: renterUserId,
        templateSlug,
      });

      await EntitlementsRepo.ensureEntitlementForOrder(rentOrder);

      const buyOrder = await OrdersService.createPendingOrder({
        userId: renterUserId,
        templateSlug,
        payload: { license: 'PU', dealType: 'BUY' },
      });

      expect(buyOrder).toBeTruthy();
      expect(buyOrder.user_id).toBe(renterUserId);
      expect(buyOrder.template_slug).toBe(templateSlug);
      expect(String(buyOrder.deal_type).toUpperCase()).toBe('BUY');
      expect(String(buyOrder.status).toLowerCase()).toBe('pending');
    });
  });
  test('RENT order requires selected rent days and owned case ids before payment', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);
      const otherUserId = await createTestUser(db);
      const templateSlug = `rent-selection-${Date.now()}-1`;

      await expect(
        OrdersService.createPendingOrder({
          userId,
          templateSlug,
          payload: { license: 'PU', dealType: 'RENT', caseIds: ['missing-days'] },
        }),
      ).rejects.toMatchObject({
        code: 'RENT_DAYS_REQUIRED',
        status: 400,
      });

      await expect(
        OrdersService.createPendingOrder({
          userId,
          templateSlug,
          payload: { license: 'PU', dealType: 'RENT', rentDays: 3 },
        }),
      ).rejects.toMatchObject({
        code: 'RENT_CASE_IDS_REQUIRED',
        status: 400,
      });

      await OrdersService.createPendingOrder({
        userId: otherUserId,
        templateSlug: `${templateSlug}-other`,
        payload: { license: 'PU', dealType: 'RENT', rentDays: 3, caseIds: [] },
      }).catch(() => null);

      const casesService = require('../src/modules/cases/cases.service.cjs');
      await casesService.ensureDefaultCaseForUser(otherUserId, db);
      const otherCases = await casesService.getOwnerCases(otherUserId, db);

      await expect(
        OrdersService.createPendingOrder({
          userId,
          templateSlug,
          payload: {
            license: 'PU',
            dealType: 'RENT',
            rentDays: 3,
            caseIds: [otherCases[0].id],
          },
        }),
      ).rejects.toMatchObject({
        code: 'RENT_CASE_NOT_OWNED',
        status: 403,
      });
    });
  });

  test('pending RENT stores rent days and case ids but entitlement starts only after payment', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);
      const templateSlug = `rent-selection-${Date.now()}-2`;
      const casesService = require('../src/modules/cases/cases.service.cjs');

      await casesService.ensureDefaultCaseForUser(userId, db);
      const cases = await casesService.getOwnerCases(userId, db);

      const order = await OrdersService.createPendingOrder({
        userId,
        templateSlug,
        payload: {
          license: 'PU',
          dealType: 'RENT',
          rentDays: 3,
          caseIds: [cases[0].id],
        },
      });

      expect(order).toBeTruthy();
      expect(String(order.status).toLowerCase()).toBe('pending');
      expect(String(order.deal_type).toUpperCase()).toBe('RENT');
      expect(Number(order.rent_days)).toBe(3);

      const beforeEntitlement = await db.query(
        `SELECT * FROM public.entitlements WHERE order_id = $1`,
        [order.id],
      );
      expect(beforeEntitlement.rows).toHaveLength(0);

      const assignments = await db.query(
        `SELECT * FROM public.order_case_assignments WHERE order_id = $1`,
        [order.id],
      );
      expect(assignments.rows).toHaveLength(1);
      expect(String(assignments.rows[0].case_id)).toBe(String(cases[0].id));

      const paidOrder = await db.query(
        `
        UPDATE public.orders
        SET status = 'paid',
            provider_session_id = $2,
            provider_payment_intent_id = $3,
            updated_at = now()
        WHERE id = $1
        RETURNING *
        `,
        [order.id, `rent_sess_${Date.now()}`, `rent_pi_${Date.now()}`],
      );

      const entitlement = await EntitlementsRepo.ensureEntitlementForOrder(paidOrder.rows[0]);
      expect(entitlement).toBeTruthy();
      expect(String(entitlement.kind).toLowerCase()).toBe('rent');
      expect(String(entitlement.deal_type).toUpperCase()).toBe('RENT');
      expect(entitlement.starts_at).toBeTruthy();
      expect(entitlement.ends_at).toBeTruthy();

      const startsAt = new Date(entitlement.starts_at).getTime();
      const endsAt = new Date(entitlement.ends_at).getTime();
      const diffDays = Math.round((endsAt - startsAt) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(3);
    });
  });

  test('active RENT assignments can be added and removed but not removed from the last case', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);
      const templateSlug = `rent-assignment-${Date.now()}-1`;
      const casesService = require('../src/modules/cases/cases.service.cjs');
      const rentAssignmentsService = require('../src/modules/cases/rentAssignments.service.cjs');

      await casesService.ensureDefaultCaseForUser(userId, db);
      const firstCase = (await casesService.getOwnerCases(userId, db))[0];
      const secondCase = await casesService.create(userId, { title: 'Second presentation case' }, db);

      const order = await OrdersService.createPendingOrder({
        userId,
        templateSlug,
        payload: {
          license: 'PU',
          dealType: 'RENT',
          rentDays: 2,
          caseIds: [firstCase.id],
        },
      });

      const paidOrder = await db.query(
        `
        UPDATE public.orders
        SET status = 'paid',
            provider_session_id = $2,
            provider_payment_intent_id = $3,
            updated_at = now()
        WHERE id = $1
        RETURNING *
        `,
        [order.id, `rent_assign_sess_${Date.now()}`, `rent_assign_pi_${Date.now()}`],
      );

      await EntitlementsRepo.ensureEntitlementForOrder(paidOrder.rows[0]);

      let assignments = await rentAssignmentsService.listAssignments(order.id, db);
      expect(assignments.map(String)).toEqual([String(firstCase.id)]);

      await expect(
        rentAssignmentsService.removeAssignment({
          userId,
          orderId: order.id,
          caseId: firstCase.id,
        }, db),
      ).rejects.toMatchObject({
        code: 'LAST_RENT_CASE_ASSIGNMENT_BLOCKED',
        status: 409,
      });

      await rentAssignmentsService.addAssignment({
        userId,
        orderId: order.id,
        caseId: secondCase.id,
      }, db);

      assignments = await rentAssignmentsService.listAssignments(order.id, db);
      expect(assignments.map(String).sort()).toEqual(
        [String(firstCase.id), String(secondCase.id)].sort(),
      );

      await rentAssignmentsService.removeAssignment({
        userId,
        orderId: order.id,
        caseId: firstCase.id,
      }, db);

      assignments = await rentAssignmentsService.listAssignments(order.id, db);
      expect(assignments.map(String)).toEqual([String(secondCase.id)]);
    });
  });

});
