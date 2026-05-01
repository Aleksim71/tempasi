// tests/buyWebhookIdempotencyHardening.integration.test.cjs
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

function requireFirst(candidates) {
  const errors = [];

  for (const rel of candidates) {
    try {
      return require(rel);
    } catch (error) {
      errors.push(`${rel}: ${error.message}`);
    }
  }

  throw new Error(`Could not require any candidate:\n${errors.join('\n')}`);
}

const db = requireDb();
const pool = resolvePool(db);

const paymentCompletion = requireFirst([
  '../src/modules/payments/paymentCompletion.service.cjs',
  '../src/modules/payments/payment-completion.service.cjs',
]);

const entitlementsRepo = requireFirst([
  '../src/modules/payments/repos/entitlements.repo.cjs',
  '../src/modules/entitlements/entitlements.repo.cjs',
]);

function getCompletePaidOrder() {
  const fn =
    paymentCompletion.completePaidOrder ||
    paymentCompletion.completeOrder ||
    paymentCompletion.markOrderPaidAndCreateEntitlement;

  if (typeof fn !== 'function') {
    throw new Error('Could not resolve completePaidOrder-like function');
  }

  return fn;
}

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
  if (name === 'provider_session_id') return context.providerSessionId;
  if (name === 'checkout_session_id') return context.providerSessionId;
  if (name === 'stripe_session_id') return context.providerSessionId;
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

async function insertOrder({ templateSlug, status = 'pending', providerSessionId } = {}) {
  const columns = await tableColumns('orders');

  const [statusValues, paymentStatusValues, licenseValues, dealTypeValues, kindValues, typeValues] = await Promise.all([
    allowedCheckValuesForColumn('orders', 'status'),
    allowedCheckValuesForColumn('orders', 'payment_status'),
    allowedCheckValuesForColumn('orders', 'license'),
    allowedCheckValuesForColumn('orders', 'deal_type'),
    allowedCheckValuesForColumn('orders', 'kind'),
    allowedCheckValuesForColumn('orders', 'type'),
  ]);

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
    'provider',
    'provider_session_id',
    'checkout_session_id',
    'stripe_session_id',
  ]
    .filter((name) => hasColumn(columns, name))
    .map((name) => columns.find((column) => column.column_name === name));

  const byName = new Map();
  for (const column of [...requiredColumns, ...explicitImportantColumns]) {
    byName.set(column.column_name, column);
  }

  const insertColumns = [...byName.values()];

  const randomInt = () => Math.floor(Math.random() * 1000000000) + 100000;
  const context = {
    templateSlug: templateSlug || `webhook-guard-${crypto.randomUUID()}`,
    templateNumericId: randomInt(),
    providerSessionId: providerSessionId || `fake_session_${crypto.randomUUID()}`,
    userId: `buyer_${crypto.randomUUID().replaceAll('-', '')}`,
    userNumericId: randomInt(),
    sellerId: `seller_${crypto.randomUUID().replaceAll('-', '')}`,
    sellerNumericId: randomInt(),
    statusValue: pickAllowedValue(statusValues, [status, 'pending', 'created', 'paid', 'completed'], status),
    paymentStatusValue: pickAllowedValue(paymentStatusValues, [status, 'pending', 'paid', 'completed'], status),
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

async function completePaidOrder(order) {
  const fn = getCompletePaidOrder();

  const attempts = [
    () => fn({ orderId: order.id, order_id: order.id, provider: 'fake', providerSessionId: order.provider_session_id || order.checkout_session_id || order.stripe_session_id }),
    () => fn(order.id),
    () => fn(order),
  ];

  let lastError;

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!/argument|undefined|cannot|missing|required|order/i.test(String(error && error.message))) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function countOrdersForTemplate(templateSlug) {
  const columns = await tableColumns('orders');
  const templateColumn = hasColumn(columns, 'template_slug') ? 'template_slug' : 'template_id';

  const result = await pool.query(
    `select count(*)::int as count from orders where "${templateColumn}" = $1`,
    [templateSlug]
  );

  return result.rows[0].count;
}

async function countEntitlementsForTemplate(templateSlug) {
  const columns = await tableColumns('entitlements');
  const templateColumn = hasColumn(columns, 'template_slug') ? 'template_slug' : hasColumn(columns, 'template_id') ? 'template_id' : null;

  if (!templateColumn) return null;

  const result = await pool.query(
    `select count(*)::int as count from entitlements where "${templateColumn}" = $1`,
    [templateSlug]
  );

  return result.rows[0].count;
}

describe('Step 6H BUY webhook/race/idempotency hardening', () => {
  beforeAll(async () => {
    await migrateDb();
  });

  afterAll(async () => {
    await closeDbAfterTest();
  });

  test('completePaidOrder is idempotent for the same BUY order', async () => {
    const templateSlug = `same-order-${crypto.randomUUID()}`;
    const order = await insertOrder({ templateSlug, status: 'pending' });

    await completePaidOrder(order);
    await completePaidOrder(order);

    const orderCount = await countOrdersForTemplate(templateSlug);
    const entitlementCount = await countEntitlementsForTemplate(templateSlug);

    expect(orderCount).toBe(1);
    if (entitlementCount !== null) {
      expect(entitlementCount).toBe(1);
    }
  });

  test('DB guard blocks a second paid BUY order even when service/webhook is bypassed', async () => {
    const templateSlug = `second-buy-${crypto.randomUUID()}`;

    const firstOrder = await insertOrder({ templateSlug, status: 'pending' });
    await completePaidOrder(firstOrder);

    await expect(insertOrder({ templateSlug, status: 'paid' })).rejects.toThrow(
      /duplicate key|unique|constraint|violates/i
    );
  });

  test('second BUY completion attempt for same template does not create extra entitlement', async () => {
    const templateSlug = `race-buy-${crypto.randomUUID()}`;

    const firstOrder = await insertOrder({ templateSlug, status: 'pending' });
    await completePaidOrder(firstOrder);

    let secondOrder = null;
    try {
      secondOrder = await insertOrder({ templateSlug, status: 'pending' });
    } catch (error) {
      expect(String(error.message)).toMatch(/duplicate key|unique|constraint|violates/i);
      return;
    }

    await expect(completePaidOrder(secondOrder)).rejects.toThrow(
      /duplicate key|unique|already|sold|exclusive|constraint|violates/i
    );

    const entitlementCount = await countEntitlementsForTemplate(templateSlug);
    if (entitlementCount !== null) {
      expect(entitlementCount).toBe(1);
    }
  });
});
