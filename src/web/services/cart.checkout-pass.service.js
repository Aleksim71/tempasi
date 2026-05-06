// path: src/web/services/cart.checkout-pass.service.js
async function tryImport(moduleUrl) {
  try {
    return await import(moduleUrl);
  } catch (_) {
    return null;
  }
}

function cartCheckoutPassEnabled() {
  return (
    process.env.NODE_ENV !== 'production' || process.env.TEMPASI_ENABLE_CART_CHECKOUT_PASS === '1'
  );
}

async function resolveDbModule() {
  const candidates = [
    new URL('../../scripts/db.pool.cjs', import.meta.url),
    new URL('../../db/pool.js', import.meta.url),
    new URL('../../db/pool.cjs', import.meta.url),
    new URL('../../config/db.cjs', import.meta.url),
  ];

  for (const url of candidates) {
    const mod = await tryImport(url.href);
    if (!mod) continue;
    if (typeof mod.getPool === 'function') return mod;
    if (mod.default && typeof mod.default.getPool === 'function') return mod.default;
    if (mod.default && mod.default.pool) {
      return {
        getPool() {
          return mod.default.pool;
        },
      };
    }
    if (mod.pool) {
      return {
        getPool() {
          return mod.pool;
        },
      };
    }
  }

  throw new Error('DB pool module was not found for checkout pass');
}

async function getPool() {
  const db = await resolveDbModule();
  const pool = db.getPool();
  if (!pool) throw new Error('DB pool is not available for checkout pass');
  return pool;
}

async function resolvePaymentsService() {
  const mod = await import(
    new URL('../../modules/payments/payments.service.cjs', import.meta.url).href
  );
  return mod.default || mod;
}

async function getColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName],
  );

  return new Set(rows.map((row) => row.column_name));
}

function pickFirst(columns, names) {
  for (const name of names) {
    if (columns.has(name)) return name;
  }
  return null;
}

function normalizeIds(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    const value = Number.parseInt(String(raw), 10);
    if (Number.isInteger(value) && value > 0) out.push(value);
  }
  return [...new Set(out)];
}

function normalizeCaseIdsFromDb(input) {
  if (!input) return [];
  const raw = Array.isArray(input)
    ? input
    : (() => {
        if (typeof input === 'string') {
          try {
            return JSON.parse(input);
          } catch (_) {
            return input.split(',');
          }
        }
        return [];
      })();

  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((id) => String(id || '').trim()).filter(Boolean))];
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
      LIMIT 1
    `,
    [tableName],
  );
  return Boolean(rows[0]);
}

async function buildPriceMap(client, templateSlugs) {
  const templateColumns = await getColumns(client, 'seller_templates');
  const slugColumn = pickFirst(templateColumns, ['slug']);
  if (!slugColumn) return new Map();

  const buyPriceColumn = pickFirst(templateColumns, [
    'buy_price_cents',
    'price_buy_cents',
    'purchase_price_cents',
    'buy_cents',
    'price_cents_buy',
  ]);

  const rentPriceColumn = pickFirst(templateColumns, [
    'rent_price_cents',
    'price_rent_cents',
    'rental_price_cents',
    'rent_cents',
    'price_cents_rent',
  ]);

  if (!buyPriceColumn && !rentPriceColumn) return new Map();

  const selectParts = [slugColumn];
  if (buyPriceColumn) selectParts.push(`${buyPriceColumn} AS buy_price_cents`);
  if (rentPriceColumn) selectParts.push(`${rentPriceColumn} AS rent_price_cents`);

  const { rows } = await client.query(
    `
      SELECT ${selectParts.join(', ')}
      FROM seller_templates
      WHERE ${slugColumn} = ANY($1::text[])
    `,
    [templateSlugs],
  );

  const priceMap = new Map();
  for (const row of rows) {
    priceMap.set(row[slugColumn], {
      buy_price_cents: Number(row.buy_price_cents || 0),
      rent_price_cents: Number(row.rent_price_cents || 0),
    });
  }

  return priceMap;
}

async function assertBuyExclusivity(client, orderColumns, items) {
  const orderSlugColumn = pickFirst(orderColumns, ['template_slug']);
  const orderDealTypeColumn = pickFirst(orderColumns, ['deal_type']);
  const orderStatusColumn = pickFirst(orderColumns, ['status']);
  if (!orderSlugColumn || !orderDealTypeColumn || !orderStatusColumn) return;

  const buySlugs = items
    .filter((item) => String(item.deal_type || '').toUpperCase() === 'BUY')
    .map((item) => item.template_slug);

  if (buySlugs.length === 0) return;

  const { rows } = await client.query(
    `
      SELECT ${orderSlugColumn} AS template_slug
      FROM orders
      WHERE ${orderSlugColumn} = ANY($1::text[])
        AND UPPER(${orderDealTypeColumn}) = 'BUY'
        AND LOWER(${orderStatusColumn}) = 'paid'
    `,
    [buySlugs],
  );

  if (rows.length > 0) {
    const sold = rows.map((row) => row.template_slug).join(', ');
    const error = new Error(`BUY already sold for: ${sold}`);
    error.statusCode = 409;
    throw error;
  }
}

async function updateUserStatus(client, userId) {
  const userColumns = await getColumns(client, 'users');
  if (!userColumns.has('status')) return;

  const { rows } = await client.query('SELECT status FROM users WHERE id = $1 LIMIT 1', [userId]);
  if (rows.length === 0) return;

  const current = String(rows[0].status || '').toLowerCase();
  let next = current;
  if (current === 'seller') next = 'full';
  else if (current === 'observer' || current === 'guest' || current === '') next = 'buyer';
  else if (current === 'buyer' || current === 'full') next = current;
  else next = 'buyer';

  if (next !== current) {
    await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, next]);
  }
}

export async function checkoutCartPass({ req = null, userId, selectedItemIds = [] }) {
  if (!cartCheckoutPassEnabled()) {
    const error = new Error('Cart checkout pass is disabled in production');
    error.statusCode = 404;
    throw error;
  }

  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const cartColumns = await getColumns(client, 'cart_items');
    const cartIdColumn = pickFirst(cartColumns, ['id']);
    const cartUserIdColumn = pickFirst(cartColumns, ['user_id']);
    const cartSlugColumn = pickFirst(cartColumns, ['template_slug']);
    const cartDealTypeColumn = pickFirst(cartColumns, ['deal_type']);
    const cartLicenseColumn = pickFirst(cartColumns, ['license']);
    const cartCaseIdsColumn = pickFirst(cartColumns, ['case_ids']);

    if (!cartIdColumn || !cartUserIdColumn || !cartSlugColumn || !cartDealTypeColumn) {
      throw new Error('cart_items schema is missing required columns');
    }

    const ids = normalizeIds(selectedItemIds);
    const whereParts = [`${cartUserIdColumn} = $1`];
    const params = [userId];

    if (ids.length > 0) {
      whereParts.push(`${cartIdColumn} = ANY($2::int[])`);
      params.push(ids);
    }

    const cartSelect = `
      SELECT
        ${cartIdColumn} AS id,
        ${cartSlugColumn} AS template_slug,
        ${cartDealTypeColumn} AS deal_type,
        ${cartLicenseColumn ? `${cartLicenseColumn} AS license` : `NULL::text AS license`},
        ${cartCaseIdsColumn ? `${cartCaseIdsColumn} AS case_ids` : `NULL::jsonb AS case_ids`}
      FROM cart_items
      WHERE ${whereParts.join(' AND ')}
      ORDER BY ${cartIdColumn} ASC
      FOR UPDATE
    `;

    const cartResult = await client.query(cartSelect, params);
    const items = cartResult.rows;

    if (items.length === 0) {
      const error = new Error('No cart items selected for checkout');
      error.statusCode = 400;
      throw error;
    }

    if (items.length !== 1) {
      const error = new Error('Cart checkout currently supports one item per checkout');
      error.statusCode = 400;
      throw error;
    }

    const orderColumns = await getColumns(client, 'orders');
    const orderUserIdColumn = pickFirst(orderColumns, [
      'buyer_user_id',
      'user_id',
      'customer_user_id',
    ]);
    const orderSlugColumn = pickFirst(orderColumns, ['template_slug']);
    const orderDealTypeColumn = pickFirst(orderColumns, ['deal_type']);
    const orderLicenseColumn = pickFirst(orderColumns, ['license']);
    const orderStatusColumn = pickFirst(orderColumns, ['status']);
    const orderAmountColumn = pickFirst(orderColumns, [
      'amount_cents',
      'price_cents',
      'total_cents',
    ]);
    const orderCurrencyColumn = pickFirst(orderColumns, ['currency']);
    const orderSourceColumn = pickFirst(orderColumns, ['source', 'checkout_source']);
    const orderCartItemIdColumn = pickFirst(orderColumns, ['cart_item_id']);
    const orderCaseIdsColumn = pickFirst(orderColumns, ['case_ids']);
    const orderProviderSessionIdColumn = pickFirst(orderColumns, ['provider_session_id']);
    const orderProviderColumn = pickFirst(orderColumns, ['provider']);
    const orderIdColumn = pickFirst(orderColumns, ['id']);

    if (!orderUserIdColumn || !orderSlugColumn || !orderDealTypeColumn) {
      throw new Error('orders schema is missing required columns');
    }

    await assertBuyExclusivity(client, orderColumns, items);

    const priceMap = await buildPriceMap(client, [
      ...new Set(items.map((item) => item.template_slug)),
    ]);

    const insertedOrderIds = [];
    let buyCount = 0;
    let rentCount = 0;

    for (const item of items) {
      const columns = [orderUserIdColumn, orderSlugColumn, orderDealTypeColumn];
      const values = [userId, item.template_slug, String(item.deal_type || '').toUpperCase()];

      if (orderLicenseColumn) {
        columns.push(orderLicenseColumn);
        values.push(item.license || null);
      }

      if (orderStatusColumn) {
        columns.push(orderStatusColumn);
        // Cart checkout must create pending orders only.
        // Payment completion is responsible for marking orders as paid.
        values.push('pending');
      }

      if (orderAmountColumn) {
        const priceRow = priceMap.get(item.template_slug) || {};
        const dealType = String(item.deal_type || '').toUpperCase();
        const amount =
          dealType === 'BUY'
            ? Number(priceRow.buy_price_cents || 0)
            : Number(priceRow.rent_price_cents || 0);
        columns.push(orderAmountColumn);
        values.push(amount);
      }

      if (orderCurrencyColumn) {
        columns.push(orderCurrencyColumn);
        values.push('EUR');
      }

      if (orderProviderColumn) {
        columns.push(orderProviderColumn);
        values.push('fake');
      }

      if (orderSourceColumn) {
        columns.push(orderSourceColumn);
        values.push('cart_checkout_pass');
      }

      if (orderCartItemIdColumn) {
        columns.push(orderCartItemIdColumn);
        values.push(item.id);
      }

      const caseIds =
        String(item.deal_type || '').toUpperCase() === 'RENT'
          ? normalizeCaseIdsFromDb(item.case_ids)
          : [];

      if (orderCaseIdsColumn) {
        columns.push(orderCaseIdsColumn);
        values.push(caseIds.length ? JSON.stringify(caseIds) : null);
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`);
      const returningClause = orderIdColumn ? ` RETURNING ${orderIdColumn} AS id` : '';

      const insertSql = `
        INSERT INTO orders (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        ${returningClause}
      `;

      const insertResult = await client.query(insertSql, values);
      if (orderIdColumn && insertResult.rows[0] && insertResult.rows[0].id != null) {
        const insertedOrderId = insertResult.rows[0].id;
        insertedOrderIds.push(insertedOrderId);

        const caseIds =
          String(item.deal_type || '').toUpperCase() === 'RENT'
            ? normalizeCaseIdsFromDb(item.case_ids)
            : [];

        if (caseIds.length > 0 && (await tableExists(client, 'order_case_assignments'))) {
          for (const caseId of caseIds) {
            await client.query(
              `
                INSERT INTO order_case_assignments(order_id, case_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING
              `,
              [insertedOrderId, caseId],
            );
          }
        }
      }

      const upperDealType = String(item.deal_type || '').toUpperCase();
      if (upperDealType === 'BUY') buyCount += 1;
      if (upperDealType === 'RENT') rentCount += 1;
    }

    if (insertedOrderIds.length !== 1) {
      const error = new Error('Cart checkout failed to create one pending order');
      error.statusCode = 500;
      throw error;
    }

    const orderResult = await client.query(
      `SELECT * FROM orders WHERE ${orderIdColumn} = $1 LIMIT 1`,
      [insertedOrderIds[0]],
    );
    const pendingOrder = orderResult.rows[0];

    const paymentsService = await resolvePaymentsService();
    const session = await paymentsService.createCheckoutSession(req, { order: pendingOrder });

    if (!session || !session.id || !session.url) {
      const error = new Error('CHECKOUT_SESSION_CREATE_FAILED');
      error.statusCode = 500;
      throw error;
    }

    if (orderProviderSessionIdColumn) {
      await client.query(
        `UPDATE orders SET ${orderProviderSessionIdColumn} = $2 WHERE ${orderIdColumn} = $1`,
        [pendingOrder.id, session.id],
      );
    }

    // Do not clear cart before payment is completed.
    // Cart cleanup must happen after canonical payment completion/webhook.
    // Do not update user business status before payment is completed.
    await client.query('COMMIT');

    return {
      count: items.length,
      buyCount,
      rentCount,
      orderIds: insertedOrderIds,
      checkoutUrl: session.url,
      sessionId: session.id,
      items,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
