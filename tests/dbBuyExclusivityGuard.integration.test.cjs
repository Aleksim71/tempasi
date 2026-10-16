// tests/dbBuyExclusivityGuard.integration.test.cjs
'use strict';

const crypto = require('crypto');

const { migrateDb } = require('./helpers/migrateDb.cjs');
const { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');

function requireDb() {
  const candidates = [
    '../src/config/db.cjs',
    '../scripts/db.pool.cjs',
    '../src/db/pool.cjs',
  ];

  for (const rel of candidates) {
    try {
      return require(rel);
    } catch (_) {
      // try next
    }
  }

  throw new Error('Could not resolve DB module');
}

function resolvePool(dbModule) {
  const candidates = [
    dbModule,
    dbModule.pool,
    dbModule.db,
    dbModule.client,
    dbModule.default,
    dbModule.default && dbModule.default.pool,
  ].filter(Boolean);

  const pool = candidates.find((candidate) => typeof candidate.query === 'function');

  if (!pool) {
    throw new Error('Could not resolve DB pool/query client');
  }

  return pool;
}

const db = requireDb();
const pool = resolvePool(db);

async function tableColumns(tableName) {
  const result = await pool.query(
    `
      select
        column_name,
        data_type,
        is_nullable,
        column_default,
        udt_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position
    `,
    [tableName]
  );

  return result.rows;
}

function hasColumn(columns, name) {
  return columns.some((column) => column.column_name === name);
}

function findFirstColumn(columns, names) {
  return names.find((name) => hasColumn(columns, name)) || null;
}

async function allowedCheckValuesForColumn(tableName, columnName) {
  const result = await pool.query(
    `
      select
        conname,
        pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = $1::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%' || $2 || '%'
      order by conname
    `,
    [tableName, columnName]
  );

  const values = [];

  for (const row of result.rows) {
    const def = String(row.def || '');
    const matches = def.matchAll(/'([^']+)'/g);
    for (const match of matches) {
      values.push(match[1]);
    }
  }

  return [...new Set(values)];
}

function pickAllowedValue(values, preferred, fallback) {
  for (const candidate of preferred) {
    if (values.includes(candidate)) return candidate;
  }

  return values[0] || fallback;
}

function literalForColumn(column, context) {
  const name = column.column_name;
  const type = `${column.data_type || ''} ${column.udt_name || ''}`.toLowerCase();

  if (name === 'template_slug') return context.templateSlug;
  if (name === 'template_id') {
    if (type.includes('int') || type.includes('numeric') || type.includes('decimal')) return context.templateNumericId;
    return context.templateSlug;
  }
  if (name === 'user_id') {
    if (type.includes('int') || type.includes('numeric') || type.includes('decimal')) return context.userNumericId;
    return context.userId;
  }
  if (name === 'buyer_id') {
    if (type.includes('int') || type.includes('numeric') || type.includes('decimal')) return context.userNumericId;
    return context.userId;
  }
  if (name === 'seller_id') {
    if (type.includes('int') || type.includes('numeric') || type.includes('decimal')) return context.sellerNumericId;
    return context.sellerId;
  }
  if (name === 'email') return `${context.userId}@example.com`;
  if (name === 'status') return context.statusValue;
  if (name === 'payment_status') return context.paymentStatusValue;
  if (name === 'license') return context.licenseValue;
  if (name === 'license_type') return context.licenseValue;
  if (name === 'deal_type') return context.dealTypeValue;
  if (name === 'kind') return context.kindValue;
  if (name === 'type') return context.typeValue;
  if (name === 'currency') return 'EUR';
  if (name === 'provider') return 'fake';
  if (name === 'provider_payment_id') return `fake_${crypto.randomUUID()}`;
  if (name === 'provider_session_id') return `fake_session_${crypto.randomUUID()}`;
  if (name === 'checkout_session_id') return `fake_session_${crypto.randomUUID()}`;
  if (name === 'stripe_session_id') return `fake_session_${crypto.randomUUID()}`;
  if (name === 'amount_cents') return 1000;
  if (name === 'gross_amount_cents') return 1000;
  if (name === 'net_amount_cents') return 1000;
  if (name === 'total_cents') return 1000;
  if (name === 'price_cents') return 1000;
  if (name === 'quantity') return 1;
  if (name === 'rent_days') return 1;
  if (name.endsWith('_at')) return new Date();

  if (type.includes('bool')) return false;
  if (type.includes('int') || type.includes('numeric') || type.includes('decimal')) return 0;
  if (type.includes('timestamp') || type.includes('date')) return new Date();
  if (type.includes('json')) return {};
  if (type.includes('uuid')) return crypto.randomUUID();

  return `${name}_${crypto.randomUUID()}`;
}

async function insertPaidBuyOrder(templateSlug) {
  const columns = await tableColumns('orders');

  const requiredColumns = columns.filter((column) => {
    if (column.column_default) return false;
    if (column.is_nullable === 'YES') return false;
    return true;
  });

  const explicitImportantColumns = [
    'template_slug',
    'template_id',
    'user_id',
    'buyer_id',
    'status',
    'payment_status',
    'license',
    'license_type',
    'deal_type',
    'kind',
    'type',
    'amount_cents',
    'total_cents',
    'currency',
  ]
    .filter((name) => hasColumn(columns, name))
    .map((name) => columns.find((column) => column.column_name === name));

  const byName = new Map();
  for (const column of [...requiredColumns, ...explicitImportantColumns]) {
    byName.set(column.column_name, column);
  }

  const insertColumns = [...byName.values()];

  if (!insertColumns.some((column) => column.column_name === 'template_slug' || column.column_name === 'template_id')) {
    throw new Error('orders table has no template_slug/template_id column to test BUY uniqueness');
  }

  const [statusValues, paymentStatusValues, licenseValues, dealTypeValues, kindValues, typeValues] = await Promise.all([
    allowedCheckValuesForColumn('orders', 'status'),
    allowedCheckValuesForColumn('orders', 'payment_status'),
    allowedCheckValuesForColumn('orders', 'license'),
    allowedCheckValuesForColumn('orders', 'deal_type'),
    allowedCheckValuesForColumn('orders', 'kind'),
    allowedCheckValuesForColumn('orders', 'type'),
  ]);

  const randomInt = () => Math.floor(Math.random() * 1000000000) + 100000;
  const context = {
    templateSlug,
    templateNumericId: randomInt(),
    userId: `buyer_${crypto.randomUUID().replaceAll('-', '')}`,
    userNumericId: randomInt(),
    sellerId: `seller_${crypto.randomUUID().replaceAll('-', '')}`,
    sellerNumericId: randomInt(),
    statusValue: pickAllowedValue(statusValues, ['paid', 'completed'], 'paid'),
    paymentStatusValue: pickAllowedValue(paymentStatusValues, ['paid', 'completed'], 'paid'),
    licenseValue: pickAllowedValue(licenseValues, ['buy', 'BUY', 'purchase'], 'buy'),
    dealTypeValue: pickAllowedValue(dealTypeValues, ['template', 'buy', 'purchase', 'BUY'], 'template'),
    kindValue: pickAllowedValue(kindValues, ['buy', 'template', 'purchase', 'BUY'], 'buy'),
    typeValue: pickAllowedValue(typeValues, ['buy', 'template', 'purchase', 'BUY'], 'buy'),
  };

  const names = insertColumns.map((column) => column.column_name);
  const values = insertColumns.map((column) => literalForColumn(column, context));
  const placeholders = names.map((_, index) => `$${index + 1}`);

  const result = await pool.query(
    `
      insert into orders (${names.map((name) => `"${name}"`).join(', ')})
      values (${placeholders.join(', ')})
      returning *
    `,
    values
  );

  return result.rows[0];
}

describe('Step 6G DB-level BUY exclusivity guard', () => {
  beforeAll(async () => {
    await migrateDb();
  });

  afterAll(async () => {
    await closeDbAfterTest();
  });

  test('orders table has a partial unique index protecting one paid BUY per template', async () => {
    const result = await pool.query(`
      select
        indexname,
        indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'orders'
      order by indexname
    `);

    const indexes = result.rows.map((row) => ({
      name: row.indexname,
      def: row.indexdef,
      normalized: `${row.indexname} ${row.indexdef}`.toLowerCase(),
    }));

    const candidate = indexes.find((index) => {
      const s = index.normalized;
      return (
        s.includes('unique') &&
        (s.includes('template_slug') || s.includes('template_id')) &&
        s.includes('buy') &&
        (s.includes('paid') || s.includes('completed'))
      );
    });

    expect(candidate).toBeTruthy();
    expect(candidate.def).toMatch(/unique/i);
    expect(candidate.def).toMatch(/template_slug|template_id/i);
    expect(candidate.def).toMatch(/buy/i);
    expect(candidate.def).toMatch(/paid|completed/i);
  });

  test('raw SQL cannot insert two paid BUY orders for the same template', async () => {
    const templateSlug = `db-guard-${crypto.randomUUID()}`;

    await insertPaidBuyOrder(templateSlug);

    await expect(insertPaidBuyOrder(templateSlug)).rejects.toThrow(
      /duplicate key|unique|constraint|violates/i
    );
  });
});
