// tests/pendingRentCheckout.integration.test.cjs
const { withDb } = require('./helpers/db.cjs');
const ordersService = require('../src/modules/orders/orders.service.cjs');
const ordersRepo = require('../src/modules/orders/orders.repo.cjs');

let templatesRepo;

function unique(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function createUser(client, email) {
  const result = await client.query(
    `
      INSERT INTO users (email, password_hash, status, created_at, updated_at)
      VALUES ($1, 'test-password-hash', 'active', now(), now())
      RETURNING id
    `,
    [email]
  );

  return result.rows[0].id;
}

async function createPublishedTemplate(client, { ownerUserId, slug }) {
  await client.query(
    `
      INSERT INTO seller_templates (
        owner_user_id,
        title,
        slug,
        short_description,
        description,
        preview_image,
        preview_url,
        demo_url,
        price_buy_cents,
        price_rent_cents,
        status,
        zip_path,
        zip_original_name,
        zip_uploaded_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'Pending RENT checkout test template.',
        'Pending RENT checkout must not hide or reserve this template before payment.',
        $4,
        $4,
        $5,
        10000,
        1000,
        'published',
        $6,
        $7,
        now(),
        now(),
        now()
      )
    `,
    [
      ownerUserId,
      `Pending Rent Template ${slug}`,
      slug,
      `/t/${slug}/preview/preview.png`,
      `/templates/${slug}`,
      `storage/zips/${slug}_v1.0.0.zip`,
      `${slug}_v1.0.0.zip`,
    ]
  );
}

async function createPendingRentOrder(_client, { userId, slug }) {
  const order = await ordersRepo.createOrder({
    userId,
    templateSlug: slug,
    dealType: 'RENT',
    license: 'PU',
    amountCents: 1000,
    currency: 'EUR',
    rentDays: 1,
    caseIds: [],
  });

  return order;
}

async function listCatalogSlugs(client) {
  if (!templatesRepo) {
    templatesRepo = await import('../src/server/catalog/templates.repo.js');
  }

  const repo = templatesRepo.default || templatesRepo;
  const selectTemplatesForCatalog =
    repo.selectTemplatesForCatalog || templatesRepo.selectTemplatesForCatalog;

  if (typeof selectTemplatesForCatalog !== 'function') {
    throw new Error(
      `templates.repo.js does not export selectTemplatesForCatalog. Exports: ${Object.keys(templatesRepo).join(', ')}`
    );
  }

  const list = await selectTemplatesForCatalog(client);
  return list.map((row) => row.slug);
}

describe('pending RENT checkout integration flow', () => {
  test('pending RENT order without entitlement does not hide template and does not block BUY', async () => {
    await withDb(async (client) => {
      const sellerId = await createUser(client, `${unique('seller_pending_rent')}@example.com`);
      const renterId = await createUser(client, `${unique('renter_pending_rent')}@example.com`);
      const buyerId = await createUser(client, `${unique('buyer_pending_rent')}@example.com`);
      const slug = unique('pending-rent-template');

      await createPublishedTemplate(client, { ownerUserId: sellerId, slug });

      expect(await listCatalogSlugs(client)).toContain(slug);

      const pendingRentOrder = await createPendingRentOrder(client, {
        userId: renterId,
        slug,
      });

      expect(String(pendingRentOrder.status).toLowerCase()).toBe('pending');
      expect(String(pendingRentOrder.deal_type).toUpperCase()).toBe('RENT');

      const rentEntitlements = await client.query(
        `
          SELECT id
          FROM entitlements
          WHERE order_id = $1
        `,
        [pendingRentOrder.id]
      );

      expect(rentEntitlements.rowCount).toBe(0);
      expect(await listCatalogSlugs(client)).toContain(slug);

      const activeReservation = await ordersRepo.findActiveRentReservationByTemplateSlug(slug);
      expect(activeReservation).toBeNull();

      const buyCheckout = await ordersService.createOrderCheckout(null, {
        userId: buyerId,
        templateSlug: slug,
        dealType: 'BUY',
      });

      expect(buyCheckout.orderId).toBeTruthy();

      const pendingBuyOrder = await client.query(
        `
          SELECT id, status, deal_type
          FROM orders
          WHERE id = $1
          LIMIT 1
        `,
        [buyCheckout.orderId]
      );

      expect(['pending', 'paid']).toContain(String(pendingBuyOrder.rows[0].status).toLowerCase());
      expect(String(pendingBuyOrder.rows[0].deal_type).toUpperCase()).toBe('BUY');
    });
  });
});
