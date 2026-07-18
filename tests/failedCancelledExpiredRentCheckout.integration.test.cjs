/**
 * tests/failedCancelledExpiredRentCheckout.integration.test.cjs
 *
 * Step 6B contract:
 * failed/cancelled/expired RENT checkout orders must not behave as active RENT reservations.
 */

const { withDb } = require('./helpers/db.cjs');

const ordersRepo = require('../src/modules/orders/orders.repo.cjs');

const RUN_ID = `${Date.now()}-${process.pid}`;

async function loadCatalogRepo() {
  const mod = await import('../src/server/catalog/templates.repo.js');
  return mod.selectTemplatesForCatalog || mod.default?.selectTemplatesForCatalog || mod.default;
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
      LIMIT 1
    `,
    [tableName]
  );

  return rows.length > 0;
}

async function getTableColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set(rows.map((row) => row.column_name));
}

async function resolveTemplateTable(client) {
  if (await tableExists(client, 'seller_templates')) return 'seller_templates';
  if (await tableExists(client, 'templates')) return 'templates';

  throw new Error('No supported template table found: expected seller_templates or templates');
}

async function insertUser(client, email) {
  const columns = await getTableColumns(client, 'users');

  const insertColumns = [];
  const values = [];
  const params = [];

  function add(column, value) {
    if (!columns.has(column)) return;

    insertColumns.push(column);
    params.push(value);
    values.push(`$${params.length}`);
  }

  add('email', email);
  add('password_hash', 'test-hash');
  add('password', 'test-hash');
  add('display_name', email.split('@')[0]);
  add('name', email.split('@')[0]);
  add('role', 'user');
  add('status', 'active');
  add('created_at', new Date());
  add('updated_at', new Date());

  if (insertColumns.length === 0) {
    throw new Error('No insertable users columns detected');
  }

  const { rows } = await client.query(
    `
      INSERT INTO users (${insertColumns.join(', ')})
      VALUES (${values.join(', ')})
      RETURNING id
    `,
    params
  );

  return rows[0].id;
}

async function insertTemplate(client, sellerId, slug) {
  const tableName = await resolveTemplateTable(client);
  const columns = await getTableColumns(client, tableName);

  const candidateValues = {
    seller_id: sellerId,
    user_id: sellerId,
    author_id: sellerId,
    owner_id: sellerId,
    owner_user_id: sellerId,
    title: 'Step 6B RENT Side Effects Template',
    name: 'Step 6B RENT Side Effects Template',
    slug,
    description: 'Template for failed/cancelled/expired RENT checkout contract test',
    price_cents: 10000,
    rent_price_cents: 1000,
    rent_cents: 1000,
    currency: 'EUR',
    status: 'published',
    is_published: true,
    allow_rent: true,
    rent_enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const insertColumns = [];
  const values = [];
  const params = [];

  for (const [column, value] of Object.entries(candidateValues)) {
    if (!columns.has(column)) continue;

    insertColumns.push(column);
    params.push(value);
    values.push(`$${params.length}`);
  }

  if (insertColumns.length === 0) {
    throw new Error(`No insertable columns detected for ${tableName}`);
  }

  const { rows } = await client.query(
    `
      INSERT INTO ${tableName} (${insertColumns.join(', ')})
      VALUES (${values.join(', ')})
      RETURNING id, slug
    `,
    params
  );

  return rows[0];
}

async function createRentOrder(client, buyerId, template, status) {
  const order = await ordersRepo.createOrder({
    userId: buyerId,
    templateSlug: template.slug,
    dealType: 'RENT',
    license: 'PU',
    amountCents: 1000,
    currency: 'EUR',
    provider: 'fake',
    rentDays: 1,
  });

  if (status !== 'pending') {
    await client.query(
      `
        UPDATE orders
        SET status = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [order.id, status]
    );
  }

  return order;
}

async function createBuyOrder(client, buyerId, template) {
  return ordersRepo.createOrder({
    userId: buyerId,
    templateSlug: template.slug,
    dealType: 'BUY',
    license: 'PU',
    amountCents: 10000,
    currency: 'EUR',
    provider: 'fake',
  });
}

async function getCatalogSlugs(client) {
  const selectTemplatesForCatalog = await loadCatalogRepo();
  const templates = await selectTemplatesForCatalog(client);
  return templates.map((template) => template.slug);
}

describe('failed/cancelled/expired RENT checkout side effects', () => {
  test.each([
    ['cancelled'],
    ['failed'],
    ['expired'],
  ])('%s RENT checkout order does not reserve/hide/block template', async (rentOrderStatus) => {
    await withDb(async (client) => {
      const sellerId = await insertUser(client, `seller-step-6b-${rentOrderStatus}-${RUN_ID}@example.test`);
      const renterId = await insertUser(client, `renter-step-6b-${rentOrderStatus}-${RUN_ID}@example.test`);
      const buyerId = await insertUser(client, `buyer-step-6b-${rentOrderStatus}-${RUN_ID}@example.test`);

      const template = await insertTemplate(
        client,
        sellerId,
        `step-6b-rent-side-effects-${rentOrderStatus}-${RUN_ID}`
      );

      await createRentOrder(client, renterId, template, rentOrderStatus);

      const catalogSlugsAfterRentOrder = await getCatalogSlugs(client);
      expect(catalogSlugsAfterRentOrder).toContain(template.slug);

      const buyOrder = await createBuyOrder(client, buyerId, template);
      expect(buyOrder).toBeTruthy();
      expect(buyOrder.id).toBeTruthy();

      const catalogSlugsAfterBuyOrder = await getCatalogSlugs(client);
      expect(catalogSlugsAfterBuyOrder).toContain(template.slug);

      const { rows: activeRentEntitlements } = await client.query(
        `
          SELECT id
          FROM entitlements
          WHERE template_slug = $1
            AND kind = 'rent'
            AND closed_at IS NULL
        `,
        [template.slug]
      );

      expect(activeRentEntitlements).toHaveLength(0);
    });
  });
});
