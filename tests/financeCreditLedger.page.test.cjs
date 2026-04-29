// path: tests/financeCreditLedger.page.test.cjs
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

function hasColumn(columns, name) {
  return columns.some((column) => column.column_name === name);
}

function pickColumn(columns, names) {
  return names.find((name) => hasColumn(columns, name)) || null;
}

function valueForRequiredColumn(column) {
  const name = column.column_name;
  const type = column.data_type;

  if (name === 'template_slug') return 'step-5m-finance-credit-ledger';
  if (name === 'email') return `step5m.${Date.now()}@example.com`;
  if (name === 'password_hash' || name === 'password_digest' || name === 'password') return 'test-password-hash';
  if (name === 'license') return 'EX';
  if (name === 'deal_type') return 'BUY';
  if (name === 'status') return 'paid';
  if (name === 'currency') return 'EUR';
  if (name === 'source') return 'step_5m_page_smoke';
  if (name === 'reason' || name === 'description' || name === 'note') return 'Step 5M Finance page smoke';

  if (name === 'created_at' || name === 'updated_at' || name.endsWith('_at')) {
    return new Date();
  }

  if (type === 'boolean') return false;
  if (['integer', 'bigint', 'smallint', 'numeric', 'double precision', 'real'].includes(type)) return 0;

  return 'step_5m_test';
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

async function seedFinanceLedgerRows(client, userId) {
  const order = await insertFlexible(client, 'orders', {
    user_id: userId,
    template_slug: 'step-5m-finance-credit-ledger',
    license: 'EX',
    deal_type: 'BUY',
    status: 'paid',
    provider: 'internal_credit_zero_pay',
    amount_cents: 5000,
    currency: 'EUR',
    created_at: new Date(Date.now() - 50_000),
    updated_at: new Date(Date.now() - 50_000),
  });

  const creditColumns = await tableColumns(client, 'account_credits');
  const creditUserColumn = pickColumn(creditColumns, [
    'user_id',
    'owner_user_id',
    'buyer_id',
    'account_user_id',
    'created_by_user_id',
  ]);

  if (!creditUserColumn) {
    throw new Error('account_credits has no known user column');
  }

  const creditOverrides = {
    [creditUserColumn]: userId,
    created_at: new Date(Date.now() - 60_000),
    updated_at: new Date(Date.now() - 60_000),
  };

  for (const amountColumn of [
    'amount_cents',
    'original_amount_cents',
    'total_amount_cents',
    'remaining_amount_cents',
    'available_amount_cents',
    'balance_cents',
  ]) {
    if (hasColumn(creditColumns, amountColumn)) {
      creditOverrides[amountColumn] = 5000;
    }
  }

  if (hasColumn(creditColumns, 'currency')) creditOverrides.currency = 'EUR';
  if (hasColumn(creditColumns, 'status')) creditOverrides.status = 'active';
  if (hasColumn(creditColumns, 'source')) creditOverrides.source = 'step_5m_page_smoke';
  if (hasColumn(creditColumns, 'reason')) creditOverrides.reason = 'Step 5M page smoke credit';
  if (hasColumn(creditColumns, 'description')) creditOverrides.description = 'Step 5M page smoke credit';

  const credit = await insertFlexible(client, 'account_credits', creditOverrides);

  const usageColumns = await tableColumns(client, 'account_credit_usages');
  const relationColumn = pickColumn(usageColumns, [
    'account_credit_id',
    'credit_id',
    'account_credit_ref_id',
    'source_account_credit_id',
  ]);

  if (!relationColumn) {
    throw new Error('account_credit_usages has no known credit relation column');
  }

  const amountColumn = pickColumn(usageColumns, [
    'amount_cents',
    'used_amount_cents',
    'reserved_amount_cents',
  ]);

  const statusColumn = pickColumn(usageColumns, [
    'status',
    'type',
    'kind',
    'movement_type',
    'reason',
  ]);

  for (const [status, amountCents, offsetMs] of [
    ['reserved', 2000, 45_000],
    ['applied', 1500, 30_000],
    ['released', 500, 15_000],
  ]) {
    const usageOverrides = {
      [relationColumn]: credit.id,
      order_id: order.id,
      created_at: new Date(Date.now() - offsetMs),
      updated_at: new Date(Date.now() - offsetMs),
    };

    if (amountColumn) usageOverrides[amountColumn] = amountCents;
    if (statusColumn) usageOverrides[statusColumn] = status;

    await insertFlexible(client, 'account_credit_usages', usageOverrides);
  }
}

describe('Finance credit ledger page smoke (via real server)', () => {
  it('redirects unauthenticated users to login', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const response = await request(srv.baseUrl)
        .get('/cabinet/finance/credit-ledger')
        .set(srv.headers);

      expect([302, 303]).toContain(response.status);
      expect(String(response.headers.location || '')).toMatch(/login/i);
    });
  });

  it('renders Finance credit ledger page for authenticated user with real ledger rows', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `finance_page_${Date.now()}@example.com`;
      const password = 'Passw0rd__OK';

      const register = await request(srv.baseUrl)
        .post('/api/auth/register')
        .set(srv.headers)
        .send({ email, password });

      expect([200, 201, 303]).toContain(register.status);

      const login = await request(srv.baseUrl)
        .post('/api/auth/login')
        .set(srv.headers)
        .send({ email, password });

      expect([200, 204, 302, 303]).toContain(login.status);

      const sidCookie = pickSidCookie(login.headers['set-cookie']);
      expect(sidCookie).toBeTruthy();

      await withClient(async (client) => {
        const userId = await findUserIdByEmail(client, email);
        await seedFinanceLedgerRows(client, userId);
      });

      const response = await request(srv.baseUrl)
        .get('/cabinet/finance/credit-ledger')
        .set(srv.headers)
        .set('Cookie', sidCookie);

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/Finance|Tempasi credit|Credit ledger|credit movements|credit history/i);
      expect(response.text).toMatch(/created/i);
      expect(response.text).toMatch(/reserved/i);
      expect(response.text).toMatch(/applied/i);
      expect(response.text).toMatch(/released/i);
      expect(response.text).toMatch(/50\.00|€50|5000|50/i);
    });
  });
});
