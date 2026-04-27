// tests/e2e.cart-checkout.flow.test.cjs
/* eslint-env node */
'use strict';

const request = require('supertest');
const pg = require('pg');
const { migrateDb } = require('./helpers/migrateDb.cjs');
const { withRealServer } = require('./helpers/realServer.cjs');

function pickSidCookie(setCookieHeader) {
  const arr = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : (setCookieHeader ? [setCookieHeader] : []);

  if (!arr.length) return null;

  const re = /^(sid|connect\.sid|tempasi\.sid|tempasi_sid|tp\.sid|session|sess|sid_cookie)=/i;

  for (const raw of arr) {
    const firstPart = String(raw).split(';')[0].trim();
    const name = firstPart.split('=')[0];
    if (re.test(`${name}=`)) return firstPart;
  }

  for (const raw of arr) {
    const s = String(raw);
    if (/httponly/i.test(s)) return s.split(';')[0].trim();
  }

  return null;
}

async function seedTemplateAndCartItem({ email }) {
  const connectionString = process.env.DATABASE_URL_TEST || '';
  if (!connectionString) throw new Error('DATABASE_URL_TEST_REQUIRED');

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  const slug = `cart-seed-${Date.now()}`;

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT id FROM public.users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const userId = userResult.rows[0]?.id;
    if (!userId) throw new Error('TEST_USER_NOT_FOUND');

    // This E2E validates cart checkout plumbing, not catalog rendering.
    // Avoid seller_templates seeding here because this table evolves across schemas.


    const cartResult = await client.query(
      `
      INSERT INTO public.cart_items (
        user_id,
        template_slug,
        deal_type,
        license,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'BUY', 'PU', NOW(), NOW())
      RETURNING id
      `,
      [userId, slug],
    );

    await client.query('COMMIT');

    return {
      userId,
      slug,
      cartItemId: cartResult.rows[0].id,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

describe('E2E: cart checkout → payment completion → entitlement', () => {
  it('cart item checkout redirects to payment success and creates entitlement', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `cart_e2e_${Date.now()}@example.com`;
      const password = 'Test12345__';

      const reg = await request(srv.baseUrl)
        .post('/api/auth/register')
        .send({ email, password });

      expect([200, 201, 303]).toContain(reg.status);

      const login = await request(srv.baseUrl)
        .post('/api/auth/login')
        .send({ email, password });

      const sidCookie = pickSidCookie(login.headers['set-cookie']);
      expect(sidCookie).toBeTruthy();

      const seeded = await seedTemplateAndCartItem({ email });

      const checkout = await request(srv.baseUrl)
        .post('/cart/checkout')
        .set('Cookie', sidCookie)
        .send({ selected_item_ids: [seeded.cartItemId] });

      expect(checkout.status).toBe(303);
      expect(checkout.headers.location).toBeTruthy();

      const successUrl = new URL(checkout.headers.location, srv.baseUrl);
      expect(successUrl.pathname).toBe('/checkout/success');

      const success = await request(srv.baseUrl)
        .get(`${successUrl.pathname}${successUrl.search}`)
        .set('Cookie', sidCookie);

      expect([200, 302, 303]).toContain(success.status);

      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST });
      const client = await pool.connect();

      try {
        const orderResult = await client.query(
          `
          SELECT id, status, provider_session_id
          FROM public.orders
          WHERE user_id = $1
            AND template_slug = $2
            AND deal_type = 'BUY'
          ORDER BY id DESC
          LIMIT 1
          `,
          [seeded.userId, seeded.slug],
        );

        expect(orderResult.rows[0]).toBeTruthy();
        expect(orderResult.rows[0].status).toBe('paid');
        expect(orderResult.rows[0].provider_session_id).toBeTruthy();

        const entitlementResult = await client.query(
          `
          SELECT id, order_id, template_slug, deal_type
          FROM public.entitlements
          WHERE user_id = $1
            AND template_slug = $2
          LIMIT 1
          `,
          [seeded.userId, seeded.slug],
        );

        expect(entitlementResult.rows[0]).toBeTruthy();
        expect(entitlementResult.rows[0].template_slug).toBe(seeded.slug);
      } finally {
        client.release();
        await pool.end();
      }
    });
  });
});
