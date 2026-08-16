// tests/catalog.rent-visibility.test.cjs
/* eslint-env node */
'use strict';

const pg = require('pg');
const { migrateDb } = require('./helpers/migrateDb.cjs');

async function withClient(fn) {
  const connectionString = process.env.DATABASE_URL_TEST;
  if (!connectionString) throw new Error('DATABASE_URL_TEST_REQUIRED');

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function createUser(client, email) {
  const result = await client.query(
    `
    INSERT INTO public.users (email, password_hash, status, created_at, updated_at)
    VALUES ($1, 'test-hash', 'active', NOW(), NOW())
    RETURNING id
    `,
    [email],
  );
  return result.rows[0].id;
}

async function seedSellerTemplate(client, slug) {
  await client.query(
    `
    INSERT INTO public.seller_templates (
      owner_user_id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      created_at,
      updated_at
    )
    VALUES (
      $1,
      'Rent Visibility Template',
      $2,
      'Template used for rent visibility tests',
      1000,
      200,
      'published',
      NOW(),
      NOW()
    )
    ON CONFLICT (slug) DO UPDATE
      SET status = 'published',
          price_buy_cents = 1000,
          price_rent_cents = 200,
          deleted_at = NULL,
          updated_at = NOW()
    `,
    [await createUser(client, `owner_${Date.now()}_${Math.random()}@example.com`), slug],
  );
}

async function createRentEntitlement(client, { userId, slug, endsAtSql }) {
  const order = await client.query(
    `
    INSERT INTO public.orders (
      user_id,
      template_slug,
      deal_type,
      license,
      amount_cents,
      currency,
      provider,
      status,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'RENT', 'PU', 200, 'EUR', 'fake', 'paid', NOW(), NOW())
    RETURNING id
    `,
    [userId, slug],
  );

  await client.query(
    `
    INSERT INTO public.entitlements (
      user_id,
      template_slug,
      kind,
      deal_type,
      order_id,
      starts_at,
      ends_at,
      created_at
    )
    VALUES ($1, $2, 'rent', 'RENT', $3, NOW(), ${endsAtSql}, NOW())
    `,
    [userId, slug, order.rows[0].id],
  );
}

describe('catalog rent visibility rules', () => {
  test('active RENT hides template from public catalog and direct details', async () => {
    await migrateDb();

    await withClient(async (client) => {
      const slug = `rent-hidden-${Date.now()}`;
      const renterId = await createUser(client, `renter_${Date.now()}@example.com`);

        await seedSellerTemplate(client, slug);
      await createRentEntitlement(client, {
        userId: renterId,
        slug,
        endsAtSql: `NOW() + interval '24 hours'`,
      });

      const repo = await import('../src/server/catalog/templates.repo.js');

      const catalog = await repo.selectTemplatesForCatalog(client);
      expect(catalog.some((t) => t.slug === slug)).toBe(false);

      const details = await repo.getTemplateBySlug(client, slug);
      expect(details).toBeNull();
    });
  });

  test('expired RENT returns template to public catalog and details', async () => {
    await migrateDb();

    await withClient(async (client) => {
      const slug = `rent-expired-${Date.now()}`;
      const renterId = await createUser(client, `renter_expired_${Date.now()}@example.com`);

        await seedSellerTemplate(client, slug);
      await createRentEntitlement(client, {
        userId: renterId,
        slug,
        endsAtSql: `NOW() - interval '1 hour'`,
      });

      const repo = await import('../src/server/catalog/templates.repo.js');

      const catalog = await repo.selectTemplatesForCatalog(client);
      expect(catalog.some((t) => t.slug === slug)).toBe(true);

      const details = await repo.getTemplateBySlug(client, slug);
      expect(details).toBeTruthy();
      expect(details.slug).toBe(slug);
    });
  });
});
