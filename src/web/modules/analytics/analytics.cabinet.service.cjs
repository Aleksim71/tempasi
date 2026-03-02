/* eslint-env node */
'use strict';

const { getPool } = require('../../../../scripts/db.pool.cjs');

const SORT_WHITELIST = new Set([
  'created_at',
  'deleted_at',
  'first_order_at',
  'rent_count',
  'rent_revenue',
  'buy_revenue',
  'sold_at',
  'total_revenue',
  'last_order_at',
]);

function normalizeSort(sortRaw) {
  const s = typeof sortRaw === 'string' ? sortRaw.trim() : '';
  if (SORT_WHITELIST.has(s)) return s;
  return 'total_revenue';
}

function normalizeDir(dirRaw) {
  const d = typeof dirRaw === 'string' ? dirRaw.trim().toLowerCase() : '';
  return d === 'asc' ? 'asc' : 'desc';
}

function getOrderByClause(sort, dir) {
  const orderDir = normalizeDir(dir);

  switch (normalizeSort(sort)) {
    case 'created_at':
      return `st.created_at ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'deleted_at':
      return `st.deleted_at ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'first_order_at':
      return `first_order_at ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'rent_count':
      return `rent_count ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'rent_revenue':
      return `rent_revenue_cents ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'buy_revenue':
      return `buy_revenue_cents ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'sold_at':
      return `sold_at ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'last_order_at':
      return `last_order_at ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'total_revenue':
    default:
      return `total_revenue_cents ${orderDir} NULLS LAST, st.id ${orderDir}`;
  }
}

function formatMoneyEurFromCents(cents) {
  if (cents === null || cents === undefined) return '0.00';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '0.00';
  return (n / 100).toFixed(2);
}

function formatIsoDateYYYYMMDD(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function getMyTemplatesKpis({ ownerUserId }) {
  if (!ownerUserId) {
    throw new Error('OWNER_USER_ID_REQUIRED');
  }

  const pool = getPool();

  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE st.deleted_at IS NULL) AS active_templates,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.template_slug = st.slug
            AND o.deal_type = 'BUY'
            AND o.status = 'paid'
        )
      ) AS sold_templates,
      COALESCE(SUM(o.amount_cents) FILTER (WHERE o.status = 'paid' AND o.deal_type = 'RENT'), 0) AS rent_revenue_cents,
      COALESCE(SUM(o.amount_cents) FILTER (WHERE o.status = 'paid'), 0) AS total_revenue_cents
    FROM seller_templates st
    LEFT JOIN orders o
      ON o.template_slug = st.slug
    WHERE st.owner_user_id = $1
  `;

  const { rows } = await pool.query(sql, [ownerUserId]);
  const r = rows && rows[0] ? rows[0] : {};

  const rentRevenueCents = Number(r.rent_revenue_cents || 0);
  const totalRevenueCents = Number(r.total_revenue_cents || 0);

  return {
    activeTemplates: Number(r.active_templates || 0),
    soldTemplates: Number(r.sold_templates || 0),
    rentRevenueCents,
    totalRevenueCents,
    rentRevenueEur: formatMoneyEurFromCents(rentRevenueCents),
    totalRevenueEur: formatMoneyEurFromCents(totalRevenueCents),
  };
}

async function getMyTemplatesRevenueSeries30d({ ownerUserId }) {
  if (!ownerUserId) {
    throw new Error('OWNER_USER_ID_REQUIRED');
  }

  const pool = getPool();

  const sql = `
    WITH days AS (
      SELECT generate_series(
        current_date - interval '29 days',
        current_date,
        interval '1 day'
      )::date AS day
    )
    SELECT
      d.day,
      COALESCE(
        SUM(o.amount_cents) FILTER (
          WHERE o.status = 'paid' AND st.owner_user_id IS NOT NULL
        ),
        0
      ) AS revenue_cents
    FROM days d
    LEFT JOIN orders o
      ON o.created_at::date = d.day
    LEFT JOIN seller_templates st
      ON st.slug = o.template_slug
      AND st.owner_user_id = $1
    GROUP BY d.day
    ORDER BY d.day ASC
  `;

  const { rows } = await pool.query(sql, [ownerUserId]);
  return (rows || []).map((r) => {
    const day = r.day ? formatIsoDateYYYYMMDD(r.day) : null;
    const revenueCents = Number(r.revenue_cents || 0);
    return {
      day,
      revenueCents,
      revenueEurStr: formatMoneyEurFromCents(revenueCents),
      label: day ? day.slice(5) : '',
    };
  });
}

async function getMyTemplatesAnalytics({ ownerUserId, sort, dir }) {
  if (!ownerUserId) {
    throw new Error('OWNER_USER_ID_REQUIRED');
  }

  const pool = getPool();
  const orderBy = getOrderByClause(sort, dir);

  const sql = `
    SELECT
      st.id,
      st.title,
      st.slug,
      st.created_at,
      st.deleted_at,
      MIN(o.created_at) FILTER (WHERE o.status = 'paid') AS first_order_at,
      MAX(o.created_at) FILTER (WHERE o.status = 'paid') AS last_order_at,
      COUNT(*) FILTER (WHERE o.status = 'paid' AND o.deal_type = 'RENT') AS rent_count,
      COALESCE(SUM(o.amount_cents) FILTER (WHERE o.status = 'paid' AND o.deal_type = 'RENT'), 0) AS rent_revenue_cents,
      COALESCE(SUM(o.amount_cents) FILTER (WHERE o.status = 'paid' AND o.deal_type = 'BUY'), 0) AS buy_revenue_cents,
      MAX(o.created_at) FILTER (WHERE o.status = 'paid' AND o.deal_type = 'BUY') AS sold_at,
      COALESCE(SUM(o.amount_cents) FILTER (WHERE o.status = 'paid'), 0) AS total_revenue_cents
    FROM seller_templates st
    LEFT JOIN orders o
      ON o.template_slug = st.slug
    WHERE st.owner_user_id = $1
    GROUP BY st.id
    ORDER BY ${orderBy}
  `;

  const { rows } = await pool.query(sql, [ownerUserId]);

  return (rows || []).map((r) => {
    const createdAt = r.created_at || null;
    const deletedAt = r.deleted_at || null;
    const firstOrderAt = r.first_order_at || null;
    const lastOrderAt = r.last_order_at || null;
    const soldAt = r.sold_at || null;

    const rentRevenueCents = Number(r.rent_revenue_cents || 0);
    const buyRevenueCents = Number(r.buy_revenue_cents || 0);
    const totalRevenueCents = Number(r.total_revenue_cents || 0);

    return {
      title: r.title,
      slug: r.slug,

      created_at: createdAt,
      deleted_at: deletedAt,
      first_order_at: firstOrderAt,
      last_order_at: lastOrderAt,
      sold_at: soldAt,

      created_at_str: formatIsoDateYYYYMMDD(createdAt),
      deleted_at_str: formatIsoDateYYYYMMDD(deletedAt),
      first_order_at_str: formatIsoDateYYYYMMDD(firstOrderAt),
      last_order_at_str: formatIsoDateYYYYMMDD(lastOrderAt),
      sold_at_str: formatIsoDateYYYYMMDD(soldAt),

      rent_count: Number(r.rent_count || 0),
      rent_revenue_cents: rentRevenueCents,
      buy_revenue_cents: buyRevenueCents,
      total_revenue_cents: totalRevenueCents,

      rent_revenue_eur: formatMoneyEurFromCents(rentRevenueCents),
      buy_revenue_eur: formatMoneyEurFromCents(buyRevenueCents),
      total_revenue_eur: formatMoneyEurFromCents(totalRevenueCents),
    };
  });
}

module.exports = {
  getMyTemplatesAnalytics,
  getMyTemplatesKpis,
  getMyTemplatesRevenueSeries30d,
};
