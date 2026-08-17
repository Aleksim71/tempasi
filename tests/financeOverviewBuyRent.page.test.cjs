// path: tests/financeOverviewBuyRent.page.test.cjs
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

  return String(arr[0]).split(';')[0].trim();
}

async function withClient(fn) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL_TEST,
  });

  await client.connect();

  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function tableColumns(client, tableName) {
  const result = await client.query(
    `
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position
    `,
    [tableName],
  );

  return result.rows;
}

function valueForRequiredColumn(column) {
  const type = String(column.data_type || '').toLowerCase();
  if (type.includes('int')) return 0;
  if (type.includes('numeric') || type.includes('double') || type.includes('real')) return 0;
  if (type.includes('bool')) return false;
  if (type.includes('timestamp') || type.includes('date')) return new Date();
  if (type.includes('json')) return {};
  return `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function insertFlexible(client, tableName, overrides) {
  const columns = await tableColumns(client, tableName);
  const insertColumns = [];
  const values = [];

  for (const column of columns) {
    const name = column.column_name;

    if (Object.prototype.hasOwnProperty.call(overrides, name)) {
      insertColumns.push(name);
      values.push(overrides[name]);
      continue;
    }

    const hasDefault = Boolean(column.column_default);
    const nullable = column.is_nullable === 'YES';

    if (hasDefault || nullable) continue;

    insertColumns.push(name);
    values.push(valueForRequiredColumn(column));
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const result = await client.query(
    `
      insert into ${tableName} (${insertColumns.join(', ')})
      values (${placeholders})
      returning *
    `,
    values,
  );

  return result.rows[0];
}

async function findUserIdByEmail(client, email) {
  const result = await client.query(
    `select id from public.users where email = $1 order by id desc limit 1`,
    [email],
  );

  if (!result.rows[0]) {
    throw new Error(`Could not find registered user by email: ${email}`);
  }

  return result.rows[0].id;
}

async function registerAndLogin(srv, email, password) {
  const register = await request(srv.baseUrl)
    .post('/api/auth/register')
    .set(srv.headers)
    .send({ email, password });

  expect([200, 201, 302, 303]).toContain(register.status);

  const login = await request(srv.baseUrl)
    .post('/api/auth/login')
    .set(srv.headers)
    .send({ email, password });

  expect(login.status).toBe(200);

  const cookie = pickSidCookie(login.headers['set-cookie']);
  expect(cookie).toBeTruthy();

  return cookie;
}

describe('Finance Overview BUY/RENT period summary (via real server)', () => {
  it('does not render the old page-level Finance heading/subtitle', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `finance_overview_noheader_${Date.now()}@example.com`;
      const password = 'Passw0rd__OK';
      const cookie = await registerAndLogin(srv, email, password);

      const response = await request(srv.baseUrl)
        .get('/cabinet/finance')
        .set(srv.headers)
        .set('Cookie', cookie);

      expect(response.status).toBe(200);
      // Sidebar nav link "Finance" still renders, but the old
      // page-level h1/subtitle block must be gone.
      expect(response.text).not.toMatch(/cabinet__title">\s*Finance\s*</i);
      expect(response.text).not.toMatch(/Your orders, payments and downloads\./i);
    });
  });

  it('renders period switch tabs (1/7/28 days) with the 28-day tab active by default', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `finance_overview_periods_${Date.now()}@example.com`;
      const password = 'Passw0rd__OK';
      const cookie = await registerAndLogin(srv, email, password);

      const response = await request(srv.baseUrl)
        .get('/cabinet/finance?tab=overview')
        .set(srv.headers)
        .set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/1 day/i);
      expect(response.text).toMatch(/7 days/i);
      expect(response.text).toMatch(/28 days/i);
      expect(response.text).toMatch(/tp-tab--sub/i);
      expect(response.text).toMatch(/href="\/cabinet\/finance\?tab&#x3D;overview&amp;period&#x3D;1"/i);
      expect(response.text).toMatch(/href="\/cabinet\/finance\?tab&#x3D;overview&amp;period&#x3D;7"/i);
      expect(response.text).toMatch(/href="\/cabinet\/finance\?tab&#x3D;overview&amp;period&#x3D;28"/i);
      // Default period is 28 days -> that link should carry is-active
      // (class comes before href in the markup, so match class -> href).
      expect(response.text).toMatch(
        /tp-tab--sub is-active"\s*href="\/cabinet\/finance\?tab&#x3D;overview&amp;period&#x3D;28"/i,
      );
    });
  });

  it('renders Buy/Rent/Balance section labels on Overview', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `finance_overview_sections_${Date.now()}@example.com`;
      const password = 'Passw0rd__OK';
      const cookie = await registerAndLogin(srv, email, password);

      const response = await request(srv.baseUrl)
        .get('/cabinet/finance?tab=overview')
        .set(srv.headers)
        .set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/finance-summary-card__title">\s*Buy\s*</i);
      expect(response.text).toMatch(/finance-summary-card__title">\s*Rent\s*</i);
      expect(response.text).toMatch(/finance-summary-card__title">\s*Balance\s*</i);
      // Balance section keeps the existing, already-tested Credit ledger CTA.
      expect(response.text).toMatch(/Tempasi credit/i);
      expect(response.text).toMatch(/Open credit ledger/i);
      expect(response.text).toMatch(/\/cabinet\/finance\/credit-ledger/i);
    });
  });

  it('computes real BUY/RENT counts and sums scoped to the selected period, for the seller\'s own templates', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `finance_overview_buyrent_${Date.now()}@example.com`;
      const password = 'Passw0rd__OK';
      const cookie = await registerAndLogin(srv, email, password);

      await withClient(async (client) => {
        const ownerUserId = await findUserIdByEmail(client, email);

        // Two separate templates for the two BUY orders — "one paid BUY
        // per template" is an existing exclusivity constraint
        // (orders_unique_paid_buy_per_template), unrelated to this patch.
        const templateRecent = await insertFlexible(client, 'seller_templates', {
          owner_user_id: ownerUserId,
          title: 'Step 5V Finance Overview Fixture (recent)',
          slug: `step-5v-finance-overview-recent-${Date.now()}`,
          status: 'published',
          price_buy_cents: 9900,
          price_rent_cents: 1900,
        });

        const templateOld = await insertFlexible(client, 'seller_templates', {
          owner_user_id: ownerUserId,
          title: 'Step 5V Finance Overview Fixture (old)',
          slug: `step-5v-finance-overview-old-${Date.now()}`,
          status: 'published',
          price_buy_cents: 9900,
          price_rent_cents: 1900,
        });

        // Inside the 7-day window: one paid BUY (5000c), one paid RENT (2600c).
        await insertFlexible(client, 'orders', {
          user_id: ownerUserId,
          template_slug: templateRecent.slug,
          deal_type: 'BUY',
          status: 'paid',
          license: 'EX',
          amount_cents: 5000,
          currency: 'EUR',
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        });

        await insertFlexible(client, 'orders', {
          user_id: ownerUserId,
          template_slug: templateRecent.slug,
          deal_type: 'RENT',
          status: 'paid',
          license: 'EX',
          amount_cents: 2600,
          currency: 'EUR',
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        });

        // Outside the 7-day window (14 days ago) — must NOT be counted
        // when period=7, but SHOULD be counted when period=28.
        await insertFlexible(client, 'orders', {
          user_id: ownerUserId,
          template_slug: templateOld.slug,
          deal_type: 'BUY',
          status: 'paid',
          license: 'EX',
          amount_cents: 7700,
          currency: 'EUR',
          created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          updated_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        });

        // Unpaid order in-window — must never be counted, any period.
        await insertFlexible(client, 'orders', {
          user_id: ownerUserId,
          template_slug: templateRecent.slug,
          deal_type: 'RENT',
          status: 'pending',
          license: 'EX',
          amount_cents: 4200,
          currency: 'EUR',
          created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        });
      });

      const response7d = await request(srv.baseUrl)
        .get('/cabinet/finance?tab=overview&period=7')
        .set(srv.headers)
        .set('Cookie', cookie);

      expect(response7d.status).toBe(200);
      // 7-day window: 1 BUY order worth €50.00, 1 RENT order worth €26.00.
      expect(response7d.text).toMatch(/finance-kpi__value">\s*1\s*</); // buy count
      expect(response7d.text).toMatch(/€50\.00/);
      expect(response7d.text).toMatch(/€26\.00/);
      expect(response7d.text).not.toMatch(/€77\.00/); // the 14-day-old BUY must be excluded

      const response28d = await request(srv.baseUrl)
        .get('/cabinet/finance?tab=overview&period=28')
        .set(srv.headers)
        .set('Cookie', cookie);

      expect(response28d.status).toBe(200);
      // 28-day window: 2 BUY orders total (€50.00 + €77.00 = €127.00), 1 RENT order (€26.00).
      expect(response28d.text).toMatch(/€127\.00/);
      expect(response28d.text).toMatch(/€26\.00/);
      // The pending RENT order's €42.00 must never surface anywhere.
      expect(response28d.text).not.toMatch(/€42\.00/);
    });
  });
});
