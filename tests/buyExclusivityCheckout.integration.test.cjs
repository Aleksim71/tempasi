// tests/buyExclusivityCheckout.integration.test.cjs

const { describe, test, expect, beforeEach, afterAll } = require('@jest/globals');
const crypto = require('crypto');

const { migrateDb } = require('./helpers/migrateDb.cjs');

let closeDbAfterTest = async () => {};
try {
  ({ closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs'));
} catch (_) {}

async function resetTestDb() {
  const db = await resolveDb();

  await db.query(`
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to public;
  `);

  await migrateDb();
}

async function closeTestDb() {
  await closeDbAfterTest().catch(() => {});
}

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
  const generatedSlug = `exclusive-buy-template-${crypto.randomBytes(4).toString('hex')}`;

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

  const sellerColumn = pickColumn(columns, ['seller_id', 'owner_user_id', 'user_id', 'owner_id', 'author_id']);
  if (sellerColumn) add(sellerColumn, sellerId);

  add('title', `Exclusive BUY Template ${crypto.randomBytes(4).toString('hex')}`);
  add('slug', generatedSlug);
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
    slug: generatedSlug,
    tableName,
  };
}


async function ensureDefaultCaseForTestBuyer(userId) {
  const casesService = require('../src/modules/cases/cases.service.cjs');

  if (typeof casesService.ensureDefaultCaseForUser === 'function') {
    await casesService.ensureDefaultCaseForUser(userId);
  }

  if (typeof casesService.listOwnedCaseIds === 'function') {
    const owned = await casesService.listOwnedCaseIds(userId);
    if (Array.isArray(owned) && owned.length > 0) {
      return owned[0];
    }
  }

  const db = await resolveDb();

  if (await tableExists(db, 'cases')) {
    const columns = await getColumns(db, 'cases');
    const userColumn = pickColumn(columns, ['user_id', 'owner_user_id', 'owner_id']);
    if (!userColumn) {
      throw new Error('cases table exists but user relation column was not found');
    }

    const titleColumn = pickColumn(columns, ['title', 'name']);
    const insertColumns = [userColumn];
    const values = [userId];
    const placeholders = ['$1'];

    if (titleColumn) {
      insertColumns.push(titleColumn);
      values.push('Step 6D Default Case');
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
        insert into cases (${insertColumns.join(', ')})
        values (${placeholders.join(', ')})
        returning id
      `,
      values
    );

    return result.rows[0].id;
  }

  throw new Error('Could not create or resolve default case for RENT checkout validation');
}

async function createOrderViaService({ buyerId, templateId, templateSlug, licenseType }) {
  const service = require('../src/modules/orders/orders.service.cjs');

  if (typeof service.createOrderCheckout !== 'function') {
    throw new Error(
      `orders.service.createOrderCheckout is required. Available exports: ${Object.keys(service).join(', ')}`
    );
  }

  const normalizedLicenseType = String(licenseType).toUpperCase();

  const payload = {
    license: 'PU',
    dealType: normalizedLicenseType,
    amountCents: normalizedLicenseType === 'BUY' ? 10000 : 1000,
    currency: 'EUR',
  };

  if (normalizedLicenseType === 'RENT') {
    const caseId = await ensureDefaultCaseForTestBuyer(buyerId);
    payload.rentDays = 1;
    payload.caseIds = [caseId];
  }

  return service.createOrderCheckout(
    {},
    {
      userId: buyerId,
      templateSlug: templateSlug || String(templateId),
      payload,
    }
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

async function countBuyEntitlements(db, { buyerId, templateId, templateSlug }) {
  if (!(await tableExists(db, 'entitlements'))) return 0;

  const columns = await getColumns(db, 'entitlements');
  const userColumn = pickColumn(columns, ['user_id', 'buyer_id', 'owner_id']);
  const directTemplateColumn = pickColumn(columns, ['template_id', 'seller_template_id']);
  const directSlugColumn = pickColumn(columns, ['template_slug', 'seller_template_slug', 'slug']);
  const orderColumn = pickColumn(columns, ['order_id']);
  const typeColumn = pickColumn(columns, ['license_type', 'license', 'type', 'kind', 'entitlement_type']);

  const values = [];
  const where = [];

  if (userColumn) {
    values.push(buyerId);
    where.push(`e.${userColumn} = $${values.length}`);
  }

  if (typeColumn) {
    values.push('BUY');
    where.push(`upper(e.${typeColumn}::text) = $${values.length}`);
  }

  if (directTemplateColumn) {
    values.push(templateId);
    where.push(`e.${directTemplateColumn} = $${values.length}`);

    const result = await db.query(
      `
        select count(*)::int as count
        from entitlements e
        where ${where.join(' and ')}
      `,
      values
    );

    return Number(result.rows[0]?.count || 0);
  }

  if (directSlugColumn) {
    values.push(templateSlug);
    where.push(`e.${directSlugColumn} = $${values.length}`);

    const result = await db.query(
      `
        select count(*)::int as count
        from entitlements e
        where ${where.join(' and ')}
      `,
      values
    );

    return Number(result.rows[0]?.count || 0);
  }

  if (orderColumn && (await tableExists(db, 'orders'))) {
    const orderColumns = await getColumns(db, 'orders');
    const orderSlugColumn = pickColumn(orderColumns, ['template_slug', 'seller_template_slug', 'slug']);
    const orderTemplateColumn = pickColumn(orderColumns, ['template_id', 'seller_template_id']);
    const orderUserColumn = pickColumn(orderColumns, ['user_id', 'buyer_id', 'owner_id']);
    const orderDealColumn = pickColumn(orderColumns, ['deal_type', 'license_type', 'license', 'type', 'kind']);

    const joinWhere = [...where];

    if (orderUserColumn && !userColumn) {
      values.push(buyerId);
      joinWhere.push(`o.${orderUserColumn} = $${values.length}`);
    }

    if (orderDealColumn && !typeColumn) {
      values.push('BUY');
      joinWhere.push(`upper(o.${orderDealColumn}::text) = $${values.length}`);
    }

    if (orderSlugColumn) {
      values.push(templateSlug);
      joinWhere.push(`o.${orderSlugColumn} = $${values.length}`);
    } else if (orderTemplateColumn) {
      values.push(templateId);
      joinWhere.push(`o.${orderTemplateColumn} = $${values.length}`);
    } else {
      throw new Error('orders table has no template slug/id column for entitlement lookup');
    }

    const result = await db.query(
      `
        select count(*)::int as count
        from entitlements e
        join orders o on o.id = e.${orderColumn}
        where ${joinWhere.join(' and ')}
      `,
      values
    );

    return Number(result.rows[0]?.count || 0);
  }

  throw new Error('Could not resolve entitlement relation by direct template column or order join');
}

async function publicCatalogContainsTemplate(db, templateId, templateSlug = null) {
  const hasTemplates = await tableExists(db, 'templates');
  const tableName = hasTemplates ? 'templates' : 'seller_templates';
  const columns = await getColumns(db, tableName);

  const conditions = ['t.id = $1'];

  if (columns.has('status')) conditions.push(`t.status = 'published'`);
  if (columns.has('visibility')) conditions.push(`t.visibility = 'public'`);
  if (columns.has('is_published')) conditions.push(`t.is_published is true`);
  if (columns.has('is_active')) conditions.push(`t.is_active is true`);

  let buyBlockSql = 'false';
  let rentBlockSql = 'false';

  if (await tableExists(db, 'entitlements')) {
    const entitlementColumns = await getColumns(db, 'entitlements');
    const directTemplateColumn = pickColumn(entitlementColumns, ['template_id', 'seller_template_id']);
    const directSlugColumn = pickColumn(entitlementColumns, ['template_slug', 'seller_template_slug', 'slug']);
    const orderColumn = pickColumn(entitlementColumns, ['order_id']);
    const entitlementTypeColumn = pickColumn(entitlementColumns, ['license_type', 'license', 'type', 'kind', 'entitlement_type']);
    const endsAtColumn = pickColumn(entitlementColumns, ['ends_at', 'expires_at', 'valid_until']);
    const statusColumn = pickColumn(entitlementColumns, ['status', 'state']);

    const activeStatusSql = statusColumn
      ? `and lower(e.${statusColumn}::text) not in ('cancelled', 'canceled', 'failed', 'expired', 'closed')`
      : '';

    const rentWindowSql = endsAtColumn
      ? `and (e.${endsAtColumn} is null or e.${endsAtColumn} > now())`
      : '';

    if (directTemplateColumn || directSlugColumn) {
      const relationSql = directTemplateColumn
        ? `e.${directTemplateColumn} = t.id`
        : `e.${directSlugColumn} = $2`;

      const typeExpr = entitlementTypeColumn
        ? `upper(e.${entitlementTypeColumn}::text)`
        : `'UNKNOWN'`;

      buyBlockSql = `
        exists (
          select 1
          from entitlements e
          where ${relationSql}
            and ${typeExpr} = 'BUY'
            ${activeStatusSql}
        )
      `;

      rentBlockSql = `
        exists (
          select 1
          from entitlements e
          where ${relationSql}
            and ${typeExpr} = 'RENT'
            ${activeStatusSql}
            ${rentWindowSql}
        )
      `;
    } else if (orderColumn && (await tableExists(db, 'orders'))) {
      const orderColumns = await getColumns(db, 'orders');
      const orderSlugColumn = pickColumn(orderColumns, ['template_slug', 'seller_template_slug', 'slug']);
      const orderTemplateColumn = pickColumn(orderColumns, ['template_id', 'seller_template_id']);
      const orderDealColumn = pickColumn(orderColumns, ['deal_type', 'license_type', 'license', 'type', 'kind']);

      const orderRelationSql = orderSlugColumn
        ? `o.${orderSlugColumn} = $2`
        : orderTemplateColumn
          ? `o.${orderTemplateColumn} = t.id`
          : null;

      if (orderRelationSql) {
        const typeExpr = entitlementTypeColumn
          ? `upper(e.${entitlementTypeColumn}::text)`
          : orderDealColumn
            ? `upper(o.${orderDealColumn}::text)`
            : `'UNKNOWN'`;

        buyBlockSql = `
          exists (
            select 1
            from entitlements e
            join orders o on o.id = e.${orderColumn}
            where ${orderRelationSql}
              and ${typeExpr} = 'BUY'
              ${activeStatusSql}
          )
        `;

        rentBlockSql = `
          exists (
            select 1
            from entitlements e
            join orders o on o.id = e.${orderColumn}
            where ${orderRelationSql}
              and ${typeExpr} = 'RENT'
              ${activeStatusSql}
              ${rentWindowSql}
          )
        `;
      }
    }
  }

  const result = await db.query(
    `
      select t.id
      from ${tableName} t
      where ${conditions.join(' and ')}
        and not (${buyBlockSql})
        and not (${rentBlockSql})
      limit 1
    `,
    [templateId, templateSlug || String(templateId)]
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

    expect(await publicCatalogContainsTemplate(db, template.id, String(template.id))).toBe(true);

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
        templateSlug: String(template.id),
      })
    ).toBe(1);

    expect(await publicCatalogContainsTemplate(db, template.id, String(template.id))).toBe(false);

    let secondBuyError;
    try {
      await createOrderViaService({
        buyerId: buyerBId,
        templateId: template.id,
        templateSlug: String(template.id),
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
        templateSlug: String(template.id),
        licenseType: 'RENT',
      });
    } catch (error) {
      laterRentError = error;
    }

    expectCheckoutBlocked(laterRentError);
  });
});
