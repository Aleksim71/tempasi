from pathlib import Path

test_path = Path("tests/buyExclusivityCheckout.integration.test.cjs")

content = r'''// tests/buyExclusivityCheckout.integration.test.cjs

const { describe, test, expect, beforeEach, afterAll } = require('@jest/globals');
const crypto = require('crypto');

const { resetTestDb, closeTestDb } = require('./helpers/dbTestUtils.cjs');

function freshEmail(prefix) {
  return `${prefix}.${crypto.randomBytes(6).toString('hex')}@example.test`;
}

async function resolveDb() {
  const candidates = [
    '../src/config/db.cjs',
    '../src/config/db.js',
    '../scripts/db.pool.cjs',
  ];

  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod?.query) return mod;
      if (mod?.pool?.query) return mod.pool;
      if (mod?.db?.query) return mod.db;
      if (mod?.default?.query) return mod.default;
    } catch (_) {}
  }

  throw new Error('Could not resolve DB client for buy exclusivity checkout test');
}

async function tableExists(db, tableName) {
  const result = await db.query(
    `
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = $1
      ) as exists
    `,
    [tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

async function getColumns(db, tableName) {
  const result = await db.query(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

function pickColumn(columns, names) {
  return names.find((name) => columns.has(name));
}

async function insertUser(db, email) {
  const columns = await getColumns(db, 'users');

  const emailColumn = pickColumn(columns, ['email']);
  if (!emailColumn) throw new Error('users.email column is required for this test');

  const insertColumns = [emailColumn];
  const values = [email];
  const placeholders = ['$1'];

  if (columns.has('password_hash')) {
    insertColumns.push('password_hash');
    values.push('test-password-hash');
    placeholders.push(`$${values.length}`);
  }

  if (columns.has('name')) {
    insertColumns.push('name');
    values.push(email.split('@')[0]);
    placeholders.push(`$${values.length}`);
  }

  if (columns.has('display_name')) {
    insertColumns.push('display_name');
    values.push(email.split('@')[0]);
    placeholders.push(`$${values.length}`);
  }

  if (columns.has('created_at')) {
    insertColumns.push('created_at');
    placeholders.push('now()');
  }

  if (columns.has('updated_at')) {
    insertColumns.push('updated_at');
    placeholders.push('now()');
  }

  const result = await db.query(
    `
      insert into users (${insertColumns.join(', ')})
      values (${placeholders.join(', ')})
      returning id
    `,
    values
  );

  return result.rows[0].id;
}

async function insertTemplate(db, sellerId) {
  const hasTemplates = await tableExists(db, 'templates');
  const tableName = hasTemplates ? 'templates' : 'seller_templates';
  const columns = await getColumns(db, tableName);

  const insertColumns = [];
  const values = [];
  const placeholders = [];

  function add(column, value) {
    if (!columns.has(column)) return;
    insertColumns.push(column);
    values.push(value);
    placeholders.push(`$${values.length}`);
  }

  function addRaw(column, rawSql) {
    if (!columns.has(column)) return;
    insertColumns.push(column);
    placeholders.push(rawSql);
  }

  const sellerColumn = pickColumn(columns, ['seller_id', 'user_id', 'owner_id', 'author_id']);
  if (sellerColumn) add(sellerColumn, sellerId);

  add('title', `Exclusive BUY Template ${crypto.randomBytes(4).toString('hex')}`);
  add('slug', `exclusive-buy-template-${crypto.randomBytes(4).toString('hex')}`);
  add('description', 'Template used by Step 6D BUY exclusivity checkout integration test.');
  add('preview_url', 'https://example.test/preview.png');
  add('thumbnail_url', 'https://example.test/thumb.png');
  add('image_url', 'https://example.test/image.png');
  add('zip_url', 'https://example.test/template.zip');
  add('file_url', 'https://example.test/template.zip');
  add('status', 'published');
  add('visibility', 'public');
  add('currency', 'EUR');

  if (columns.has('price_cents')) add('price_cents', 10000);
  if (columns.has('buy_price_cents')) add('buy_price_cents', 10000);
  if (columns.has('rent_price_cents')) add('rent_price_cents', 1000);
  if (columns.has('price')) add('price', 100);

  if (columns.has('is_published')) add('is_published', true);
  if (columns.has('is_active')) add('is_active', true);
  if (columns.has('is_available')) add('is_available', true);
  if (columns.has('allow_rent')) add('allow_rent', true);
  if (columns.has('rent_enabled')) add('rent_enabled', true);
  if (columns.has('available_for_rent')) add('available_for_rent', true);

  addRaw('created_at', 'now()');
  addRaw('updated_at', 'now()');

  const result = await db.query(
    `
      insert into ${tableName} (${insertColumns.join(', ')})
      values (${placeholders.join(', ')})
      returning id
    `,
    values
  );

  return {
    id: result.rows[0].id,
    tableName,
  };
}

async function createOrderViaService({ buyerId, templateId, licenseType }) {
  const service = require('../src/modules/orders/orders.service.cjs');

  const candidates = [
    () => service.createCheckoutOrder?.({
      userId: buyerId,
      buyerId,
      templateId,
      licenseType,
      type: licenseType,
      kind: licenseType,
      quantity: 1,
    }),
    () => service.createOrder?.({
      userId: buyerId,
      buyerId,
      templateId,
      licenseType,
      type: licenseType,
      kind: licenseType,
      quantity: 1,
    }),
    () => service.createCheckout?.({
      userId: buyerId,
      buyerId,
      templateId,
      licenseType,
      type: licenseType,
      kind: licenseType,
      quantity: 1,
    }),
    () => service.startCheckout?.({
      userId: buyerId,
      buyerId,
      templateId,
      licenseType,
      type: licenseType,
      kind: licenseType,
      quantity: 1,
    }),
    () => service.checkout?.({
      userId: buyerId,
      buyerId,
      templateId,
      licenseType,
      type: licenseType,
      kind: licenseType,
      quantity: 1,
    }),
  ];

  let lastError;
  for (const candidate of candidates) {
    try {
      const result = await candidate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;

  throw new Error(
    `Could not find compatible orders.service checkout/create method. Available exports: ${Object.keys(service).join(', ')}`
  );
}

async function completeOrderViaPaymentService(orderLike) {
  const completion = require('../src/modules/payments/paymentCompletion.service.cjs');

  const orderId =
    orderLike?.orderId ||
    orderLike?.order_id ||
    orderLike?.id ||
    orderLike?.order?.id ||
    orderLike?.order?.orderId ||
    orderLike?.checkout?.orderId;

  if (!orderId) {
    throw new Error(`Could not resolve order id from order result: ${JSON.stringify(orderLike)}`);
  }

  const candidates = [
    () => completion.completePaidOrder?.({ orderId }),
    () => completion.completePaidOrder?.(orderId),
    () => completion.completeOrder?.({ orderId }),
    () => completion.completeOrder?.(orderId),
    () => completion.markOrderPaid?.({ orderId }),
    () => completion.markOrderPaid?.(orderId),
  ];

  let lastError;
  for (const candidate of candidates) {
    try {
      const result = await candidate();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;

  throw new Error(
    `Could not find compatible paymentCompletion service method. Available exports: ${Object.keys(completion).join(', ')}`
  );
}

async function countBuyEntitlements(db, { buyerId, templateId }) {
  if (!(await tableExists(db, 'entitlements'))) return 0;

  const columns = await getColumns(db, 'entitlements');
  const userColumn = pickColumn(columns, ['user_id', 'buyer_id', 'owner_id']);
  const templateColumn = pickColumn(columns, ['template_id', 'seller_template_id']);
  const typeColumn = pickColumn(columns, ['license_type', 'type', 'kind', 'entitlement_type']);

  if (!userColumn || !templateColumn) {
    throw new Error('entitlements table needs user and template relation columns for this test');
  }

  const values = [buyerId, templateId];
  let where = `${userColumn} = $1 and ${templateColumn} = $2`;

  if (typeColumn) {
    values.push('BUY');
    where += ` and upper(${typeColumn}::text) = $3`;
  }

  const result = await db.query(
    `
      select count(*)::int as count
      from entitlements
      where ${where}
    `,
    values
  );

  return Number(result.rows[0]?.count || 0);
}

async function publicCatalogContainsTemplate(db, templateId) {
  const repo = require('../src/server/catalog/templates.repo.js');

  const methods = [
    () => repo.listPublicTemplates?.({}),
    () => repo.listPublicTemplates?.(),
    () => repo.listTemplates?.({}),
    () => repo.listTemplates?.(),
    () => repo.getPublicTemplates?.({}),
    () => repo.getPublicTemplates?.(),
  ];

  for (const method of methods) {
    const result = await method();
    if (!result) continue;

    const rows = Array.isArray(result)
      ? result
      : Array.isArray(result.rows)
        ? result.rows
        : Array.isArray(result.templates)
          ? result.templates
          : [];

    if (rows.length || Array.isArray(result)) {
      return rows.some((row) => String(row.id) === String(templateId));
    }
  }

  // Fallback: if repo API changed, assert directly against likely public availability columns.
  const hasTemplates = await tableExists(db, 'templates');
  const tableName = hasTemplates ? 'templates' : 'seller_templates';
  const columns = await getColumns(db, tableName);

  const conditions = ['id = $1'];

  if (columns.has('status')) conditions.push(`status = 'published'`);
  if (columns.has('is_published')) conditions.push(`is_published is true`);
  if (columns.has('is_active')) conditions.push(`is_active is true`);

  const result = await db.query(
    `
      select id
      from ${tableName}
      where ${conditions.join(' and ')}
      limit 1
    `,
    [templateId]
  );

  return result.rowCount > 0;
}

function expectCheckoutBlocked(error) {
  expect(error).toBeTruthy();

  const message = String(error?.message || error || '').toLowerCase();

  expect(message).toMatch(
    /sold|exclusive|already.*buy|already.*sold|not.*available|unavailable|entitlement|purchased|reserved|blocked/
  );
}

describe('Step 6D BUY exclusivity through real checkout/payment service', () => {
  let db;

  beforeEach(async () => {
    jest.resetModules();
    await resetTestDb();
    db = await resolveDb();
  });

  afterAll(async () => {
    await closeTestDb().catch(() => {});
  });

  test('successful BUY checkout makes template permanently exclusive and blocks later BUY/RENT checkout attempts', async () => {
    const sellerId = await insertUser(db, freshEmail('seller.step6d'));
    const buyerAId = await insertUser(db, freshEmail('buyer-a.step6d'));
    const buyerBId = await insertUser(db, freshEmail('buyer-b.step6d'));
    const template = await insertTemplate(db, sellerId);

    expect(await publicCatalogContainsTemplate(db, template.id)).toBe(true);

    const buyOrder = await createOrderViaService({
      buyerId: buyerAId,
      templateId: template.id,
      licenseType: 'BUY',
    });

    await completeOrderViaPaymentService(buyOrder);
    await completeOrderViaPaymentService(buyOrder);

    expect(
      await countBuyEntitlements(db, {
        buyerId: buyerAId,
        templateId: template.id,
      })
    ).toBe(1);

    expect(await publicCatalogContainsTemplate(db, template.id)).toBe(false);

    let secondBuyError;
    try {
      await createOrderViaService({
        buyerId: buyerBId,
        templateId: template.id,
        licenseType: 'BUY',
      });
    } catch (error) {
      secondBuyError = error;
    }

    expectCheckoutBlocked(secondBuyError);

    let laterRentError;
    try {
      await createOrderViaService({
        buyerId: buyerBId,
        templateId: template.id,
        licenseType: 'RENT',
      });
    } catch (error) {
      laterRentError = error;
    }

    expectCheckoutBlocked(laterRentError);
  });
});
'''

test_path.write_text(content, encoding="utf-8")
print(f"created {test_path}")
