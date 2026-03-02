/* eslint-env node */
'use strict';

const { getPool } = require('../../../../scripts/db.pool.cjs');

const SORT_WHITELIST = new Set([
  'created_at',
  'deleted_at',
  'rent_count',
  'rent_revenue',
  'buy_revenue',
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
    case 'rent_count':
      return `rent_count ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'rent_revenue':
      return `rent_revenue_cents ${orderDir} NULLS LAST, st.id ${orderDir}`;
    case 'buy_revenue':
      return `buy_revenue_cents ${orderDir} NULLS LAST, st.id ${orderDir}`;
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
      COALESCE(SUM(o.amount_cents) FILTER (WHERE o.status = 'paid'), 0) AS total_revenue_cents
    FROM seller_templates st
    LEFT JOIN orders o
      ON o.template_slug = st.slug
    WHERE st.owner_user_id = $1
    GROUP BY st.id
    ORDER BY ${orderBy}
  `;

  const { rows } = await pool.query(sql, [ownerUserId]);

  return (rows || []).map((r) => ({
    title: r.title,
    slug: r.slug,
    created_at: r.created_at || null,
    deleted_at: r.deleted_at || null,
    first_order_at: r.first_order_at || null,
    last_order_at: r.last_order_at || null,
    rent_count: Number(r.rent_count || 0),
    rent_revenue_cents: Number(r.rent_revenue_cents || 0),
    buy_revenue_cents: Number(r.buy_revenue_cents || 0),
    total_revenue_cents: Number(r.total_revenue_cents || 0),
    rent_revenue_eur: formatMoneyEurFromCents(r.rent_revenue_cents),
    buy_revenue_eur: formatMoneyEurFromCents(r.buy_revenue_cents),
    total_revenue_eur: formatMoneyEurFromCents(r.total_revenue_cents),
  }));
}

module.exports = {
  getMyTemplatesAnalytics,
};

