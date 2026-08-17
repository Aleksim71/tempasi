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

  // TEMPASI_ANALYTICS_KPI_FIX (2026-08-16)
  //
  // Two real bugs fixed here, found while chasing a "community shows
  // 9, Overview KPIs show 10" report:
  //
  // 1. COUNT(*) FILTER (...) counted JOINED ROWS, not distinct
  //    templates — the LEFT JOIN to orders fans out one row per
  //    order, so a template with 2 paid orders (e.g. rented twice)
  //    got counted twice in every COUNT(*)-based metric below.
  //    Confirmed with a standalone model before touching the SQL:
  //    1 template + 2 orders \u2192 old COUNT(*) said 2, should say 1.
  //    Fixed with COUNT(DISTINCT st.id) everywhere that counts
  //    templates (the SUM()-based revenue numbers were never affected
  //    — summing every matching order's amount is correct there,
  //    duplicates are real separate orders, not join artifacts).
  //
  // 2. "active_templates" only checked deleted_at IS NULL — i.e.
  //    "not soft-deleted", NOT "actually published and currently
  //    live in the catalog". A sold, withdrawn, admin-blocked, or
  //    on-hold template still counted as "active" here even though
  //    the public catalog/community page (templates.repo.js's
  //    selectTemplatesForCatalogPage, community.pages.routes.cjs)
  //    already correctly excludes all of those. Added the same
  //    visibility conditions here so "Active templates" actually
  //    means "currently live", matching what buyers can see.
  //
  // total_templates (new) is the old, broader "not deleted" count,
  // now correctly distinct-counted — this is what the cabinet page
  // surfaces as "My templates": everything you own regardless of
  // status, as opposed to "Active templates" which is now only
  // what's actually purchasable right now.
  const sql = `
    SELECT
      COUNT(DISTINCT st.id) FILTER (WHERE st.deleted_at IS NULL) AS total_templates,
      COUNT(DISTINCT st.id) FILTER (
        WHERE st.deleted_at IS NULL
          AND st.status = 'published'
          AND st.owner_withdrawn_at IS NULL
          AND st.admin_blocked_at IS NULL
          AND (st.owner_hold_until IS NULL OR st.owner_hold_until <= NOW())
          AND NOT EXISTS (
            SELECT 1
            FROM orders o2
            WHERE o2.template_slug = st.slug
              AND o2.deal_type = 'BUY'
              AND o2.status = 'paid'
          )
      ) AS active_templates,
      COUNT(DISTINCT st.id) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM orders o3
          WHERE o3.template_slug = st.slug
            AND o3.deal_type = 'BUY'
            AND o3.status = 'paid'
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
    totalTemplates: Number(r.total_templates || 0),
    activeTemplates: Number(r.active_templates || 0),
    soldTemplates: Number(r.sold_templates || 0),
    rentRevenueCents,
    totalRevenueCents,
    rentRevenueEur: formatMoneyEurFromCents(rentRevenueCents),
    totalRevenueEur: formatMoneyEurFromCents(totalRevenueCents),
  };
}

// TEMPASI_MY_TEMPLATES_AVG_PRICES (2026-08-16)
//
// Personal-scope counterpart to getPlatformStats()'s avg_buy_cents /
// avg_rent_cents — same "currently live" visibility rule (published,
// not deleted, not withdrawn, not admin-blocked, hold expired, not
// sold), just scoped to this one seller's own templates instead of
// the whole platform. Deliberately its OWN query, not folded into
// getMyTemplatesKpis() above — that function's LEFT JOIN to orders
// fans out one row per order (needed there for the SUM() revenue
// totals), and averaging price over a fanned-out join would silently
// skew toward templates with more orders. This query never joins
// orders directly (only a NOT EXISTS subquery, which doesn't
// multiply rows), so it's safe from that class of bug by
// construction.
async function getMyTemplatesAvgPrices({ ownerUserId }) {
  if (!ownerUserId) {
    throw new Error('OWNER_USER_ID_REQUIRED');
  }

  const pool = getPool();

  const sql = `
    SELECT
      AVG(st.price_buy_cents) AS avg_buy_cents,
      AVG(st.price_rent_cents) AS avg_rent_cents
    FROM seller_templates st
    WHERE st.owner_user_id = $1
      AND st.status = 'published'
      AND st.deleted_at IS NULL
      AND st.owner_withdrawn_at IS NULL
      AND st.admin_blocked_at IS NULL
      AND (st.owner_hold_until IS NULL OR st.owner_hold_until <= NOW())
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.template_slug = st.slug AND o.deal_type = 'BUY' AND o.status = 'paid'
      )
  `;

  const { rows } = await pool.query(sql, [ownerUserId]);
  const r = rows?.[0] || {};
  const avgBuyCents = Math.round(Number(r.avg_buy_cents || 0));
  const avgRentCents = Math.round(Number(r.avg_rent_cents || 0));

  return {
    avgTemplatePriceEur: formatMoneyEurFromCents(avgBuyCents),
    avgRentPricePerDayEur: formatMoneyEurFromCents(avgRentCents),
  };
}

// TEMPASI_ADVANCED_REALIZED_AVG_PRICES (2026-08-16)
//
// Advanced tab's counterpart to Overview's "currently listed" price
// averages: instead of averaging the LIST price of templates that are
// still live, this averages the LIST price of templates that
// actually SOLD (for buy) or were actually RENTED at least once (for
// rent) — "what did buyers really pay for, on average", not "what's
// currently on offer". Uses the template's own price_buy_cents /
// price_rent_cents (not the order's amount_cents), matching how
// getMyTemplatesAvgPrices() already reads prices — this sidesteps
// having to normalize a RENT order's total amount_cents (price ×
// however many days were rented) back down to a per-day rate; the
// per-day rate already lives on the template itself.
//
// Deliberately no LEFT JOIN to orders (only EXISTS subqueries, which
// don't multiply rows) — same fan-out-avoidance reasoning as
// getMyTemplatesAvgPrices().
async function getMyTemplatesRealizedAvgPrices({ ownerUserId }) {
  if (!ownerUserId) {
    throw new Error('OWNER_USER_ID_REQUIRED');
  }

  const pool = getPool();

  const sql = `
    SELECT
      AVG(st.price_buy_cents) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM orders o
          WHERE o.template_slug = st.slug AND o.deal_type = 'BUY' AND o.status = 'paid'
        )
      ) AS avg_sold_cents,
      AVG(st.price_rent_cents) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM orders o2
          WHERE o2.template_slug = st.slug AND o2.deal_type = 'RENT' AND o2.status = 'paid'
        )
      ) AS avg_rented_cents
    FROM seller_templates st
    WHERE st.owner_user_id = $1
  `;

  const { rows } = await pool.query(sql, [ownerUserId]);
  const r = rows?.[0] || {};
  const avgSoldCents = Math.round(Number(r.avg_sold_cents || 0));
  const avgRentedCents = Math.round(Number(r.avg_rented_cents || 0));

  return {
    avgTemplatePriceEur: formatMoneyEurFromCents(avgSoldCents),
    avgRentPricePerDayEur: formatMoneyEurFromCents(avgRentedCents),
  };
}

// Same as getMyTemplatesRealizedAvgPrices() above, platform-wide
// instead of scoped to one seller — the Advanced tab's Market row.
async function getPlatformRealizedAvgPrices() {
  const pool = getPool();

  const sql = `
    SELECT
      AVG(st.price_buy_cents) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM orders o
          WHERE o.template_slug = st.slug AND o.deal_type = 'BUY' AND o.status = 'paid'
        )
      ) AS avg_sold_cents,
      AVG(st.price_rent_cents) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM orders o2
          WHERE o2.template_slug = st.slug AND o2.deal_type = 'RENT' AND o2.status = 'paid'
        )
      ) AS avg_rented_cents
    FROM seller_templates st
  `;

  const { rows } = await pool.query(sql);
  const r = rows?.[0] || {};
  const avgSoldCents = Math.round(Number(r.avg_sold_cents || 0));
  const avgRentedCents = Math.round(Number(r.avg_rented_cents || 0));

  return {
    avgTemplatePriceEur: formatMoneyEurFromCents(avgSoldCents),
    avgRentPricePerDayEur: formatMoneyEurFromCents(avgRentedCents),
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

// TEMPASI_FINANCE_BUY_RENT_SUMMARY (2026-08-17)
//
// Seller-scope BUY/RENT summary for a rolling window (1/7/28 days),
// used by the Finance > Overview tab. Deliberately its OWN query
// (not reusing getMyTemplatesKpis()'s LEFT JOIN) for two reasons:
// 1. It needs a time window (created_at >= NOW() - N days), which
//    getMyTemplatesKpis() doesn't have.
// 2. It counts ORDERS (COUNT(o.id), not templates), so the usual
//    "COUNT(DISTINCT st.id) to avoid LEFT JOIN fan-out" rule doesn't
//    apply here — every matching order is meant to be counted once,
//    fan-out per order is correct, not a bug (same reasoning as the
//    SUM()-based revenue numbers in getMyTemplatesKpis()).
// make_interval() instead of string-concatenating the interval —
// days always comes from a whitelisted set (1/7/28) validated by the
// route before this is called, but make_interval() avoids ever
// needing to trust a raw string in SQL regardless.
async function getMyTemplatesBuyRentSummary({ ownerUserId, days }) {
  if (!ownerUserId) {
    throw new Error('OWNER_USER_ID_REQUIRED');
  }

  const pool = getPool();
  const windowDays = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.floor(Number(days)) : 28;

  const sql = `
    SELECT
      COUNT(o.id) FILTER (
        WHERE o.deal_type = 'BUY'
          AND o.status = 'paid'
          AND o.created_at >= NOW() - make_interval(days => $2::int)
      ) AS buy_count,
      COALESCE(SUM(o.amount_cents) FILTER (
        WHERE o.deal_type = 'BUY'
          AND o.status = 'paid'
          AND o.created_at >= NOW() - make_interval(days => $2::int)
      ), 0) AS buy_cents,
      COUNT(o.id) FILTER (
        WHERE o.deal_type = 'RENT'
          AND o.status = 'paid'
          AND o.created_at >= NOW() - make_interval(days => $2::int)
      ) AS rent_count,
      COALESCE(SUM(o.amount_cents) FILTER (
        WHERE o.deal_type = 'RENT'
          AND o.status = 'paid'
          AND o.created_at >= NOW() - make_interval(days => $2::int)
      ), 0) AS rent_cents
    FROM seller_templates st
    LEFT JOIN orders o
      ON o.template_slug = st.slug
    WHERE st.owner_user_id = $1
  `;

  const { rows } = await pool.query(sql, [ownerUserId, windowDays]);
  const r = rows && rows[0] ? rows[0] : {};

  const buyCents = Number(r.buy_cents || 0);
  const rentCents = Number(r.rent_cents || 0);

  return {
    days: windowDays,
    buyCount: Number(r.buy_count || 0),
    buyCents,
    buySumEur: formatMoneyEurFromCents(buyCents),
    rentCount: Number(r.rent_count || 0),
    rentCents,
    rentSumEur: formatMoneyEurFromCents(rentCents),
  };
}

// TEMPASI_ANALYTICS_PLATFORM_STATS (2026-08-16)
//
// Platform-wide (not per-seller) market-sizing numbers, shown on the
// Analytics Overview tab to help a seller price their own templates
// competitively — same numbers Admin > Dashboard already shows the
// owner, now also surfaced to sellers on purpose (confirmed with
// Alex: intentional, no reason found to hide it — helping sellers
// price against the live market is the whole point of showing it).
//
// "Live catalog" here means the exact same visibility rule the public
// catalog itself uses (templates.repo.js's
// selectTemplatesForCatalogPage): published, not deleted, not
// withdrawn, not admin-blocked, hold expired, owner not self-deleted,
// and not already sold via a paid BUY order. Averages and the total
// count are all scoped to that same set on purpose — a sold or
// withdrawn template isn't something a new seller is actually
// competing against right now.
// TEMPASI_CATEGORY_TABLE (2026-08-16)
//
// Replaces the old per-template sortable Table tab with a
// per-category, platform-wide breakdown (confirmed with Alex: fully
// replaces the old table, and is platform-wide like Market/Advanced,
// not scoped to one seller).
//
// A category row appears if it has at least one seller_templates row
// EVER (not just currently-live ones) — this lets a category with
// zero live listings right now still show its realized sold/rented
// prices, rather than disappearing entirely. template_count and the
// two "listed price" averages ARE scoped to currently-live templates
// (same visibility rule as getPlatformStats()); the two "realized
// price" averages are scoped to templates that actually sold/were
// actually rented (same EXISTS pattern as
// getPlatformRealizedAvgPrices()), independent of current live
// status.
//
// No LEFT JOIN to orders (only EXISTS subqueries) — same fan-out
// avoidance as every other averaging query added this session. The
// LEFT JOINs to users and catalog_categories are both 1:1 (a
// template has exactly one owner, a category slug matches at most
// one catalog_categories row), so neither of those can multiply
// rows either.
async function getPlatformStatsByCategory() {
  const pool = getPool();

  const sql = `
    SELECT
      COALESCE(cc.label, st.category, 'Other') AS category_label,
      COUNT(*) FILTER (
        WHERE st.status = 'published'
          AND st.deleted_at IS NULL
          AND st.owner_withdrawn_at IS NULL
          AND st.admin_blocked_at IS NULL
          AND (st.owner_hold_until IS NULL OR st.owner_hold_until <= NOW())
          AND u.self_deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM orders ob
            WHERE ob.template_slug = st.slug AND ob.deal_type = 'BUY' AND ob.status = 'paid'
          )
      )::int AS template_count,
      AVG(st.price_buy_cents) FILTER (
        WHERE st.status = 'published'
          AND st.deleted_at IS NULL
          AND st.owner_withdrawn_at IS NULL
          AND st.admin_blocked_at IS NULL
          AND (st.owner_hold_until IS NULL OR st.owner_hold_until <= NOW())
          AND u.self_deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM orders ob2
            WHERE ob2.template_slug = st.slug AND ob2.deal_type = 'BUY' AND ob2.status = 'paid'
          )
      ) AS avg_list_buy_cents,
      AVG(st.price_rent_cents) FILTER (
        WHERE st.status = 'published'
          AND st.deleted_at IS NULL
          AND st.owner_withdrawn_at IS NULL
          AND st.admin_blocked_at IS NULL
          AND (st.owner_hold_until IS NULL OR st.owner_hold_until <= NOW())
          AND u.self_deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM orders ob3
            WHERE ob3.template_slug = st.slug AND ob3.deal_type = 'BUY' AND ob3.status = 'paid'
          )
      ) AS avg_list_rent_cents,
      AVG(st.price_buy_cents) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM orders os
          WHERE os.template_slug = st.slug AND os.deal_type = 'BUY' AND os.status = 'paid'
        )
      ) AS avg_sold_cents,
      AVG(st.price_rent_cents) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM orders ordr
          WHERE ordr.template_slug = st.slug AND ordr.deal_type = 'RENT' AND ordr.status = 'paid'
        )
      ) AS avg_rented_cents
    FROM seller_templates st
    LEFT JOIN users u ON u.id = st.owner_user_id
    LEFT JOIN catalog_categories cc ON cc.slug = st.category
    GROUP BY COALESCE(cc.label, st.category, 'Other')
    ORDER BY COALESCE(cc.label, st.category, 'Other') ASC
  `;

  const { rows } = await pool.query(sql);

  return (rows || []).map((r) => ({
    category: r.category_label,
    templateCount: Number(r.template_count || 0),
    avgListBuyEur: formatMoneyEurFromCents(Math.round(Number(r.avg_list_buy_cents || 0))),
    avgListRentEur: formatMoneyEurFromCents(Math.round(Number(r.avg_list_rent_cents || 0))),
    avgSoldEur: formatMoneyEurFromCents(Math.round(Number(r.avg_sold_cents || 0))),
    avgRentedEur: formatMoneyEurFromCents(Math.round(Number(r.avg_rented_cents || 0))),
  }));
}

async function getPlatformStats() {
  const pool = getPool();

  const usersSql = `SELECT COUNT(*)::int AS n FROM users WHERE status = 'active'`;

  const templatesSql = `
    SELECT
      COUNT(*)::int AS total_templates,
      AVG(st.price_buy_cents) AS avg_buy_cents,
      AVG(st.price_rent_cents) AS avg_rent_cents
    FROM seller_templates st
    LEFT JOIN users u ON u.id = st.owner_user_id
    WHERE st.status = 'published'
      AND st.deleted_at IS NULL
      AND st.owner_withdrawn_at IS NULL
      AND st.admin_blocked_at IS NULL
      AND (st.owner_hold_until IS NULL OR st.owner_hold_until <= NOW())
      AND u.self_deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.template_slug = st.slug AND o.deal_type = 'BUY' AND o.status = 'paid'
      )
  `;

  const [usersRes, templatesRes] = await Promise.all([
    pool.query(usersSql),
    pool.query(templatesSql),
  ]);

  const totalUsers = Number(usersRes.rows?.[0]?.n || 0);
  const t = templatesRes.rows?.[0] || {};
  const totalTemplates = Number(t.total_templates || 0);
  const avgBuyCents = Math.round(Number(t.avg_buy_cents || 0));
  const avgRentCents = Math.round(Number(t.avg_rent_cents || 0));

  return {
    totalUsers,
    totalTemplates,
    avgTemplatePriceEur: formatMoneyEurFromCents(avgBuyCents),
    avgRentPricePerDayEur: formatMoneyEurFromCents(avgRentCents),
  };
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


async function getCabinetAnalytics({ ownerUserId, months = 6, sort, dir } = {}) {
  const [summary, topTemplates, monthlyRevenue] = await Promise.all([
    getMyTemplatesKpis({ ownerUserId }),
    getMyTemplatesAnalytics({ ownerUserId, sort, dir }),
    getMyTemplatesRevenueSeries30d({ ownerUserId }),
  ]);

  return {
    summary: {
      templatesCount: Number(summary.totalTemplates || 0),
      publishedCount: Number(summary.activeTemplates || 0),
      soldTemplatesCount: Number(summary.soldTemplates || 0),
      buyOrdersCount: topTemplates.reduce((acc, row) => acc + (row.sold_at ? 1 : 0), 0),
      rentOrdersCount: topTemplates.reduce((acc, row) => acc + Number(row.rent_count || 0), 0),
      revenueBuyEur: (topTemplates.reduce((acc, row) => acc + Number(row.buy_revenue_cents || 0), 0) / 100).toFixed(2),
      revenueRentEur: String(summary.rentRevenueEur || '0.00'),
      revenueTotalEur: String(summary.totalRevenueEur || '0.00'),
    },
    topTemplates,
    monthlyRevenue,
    months,
  };
}

module.exports = {
  getCabinetAnalytics,
  getMyTemplatesAnalytics,
  getMyTemplatesKpis,
  getMyTemplatesAvgPrices,
  getMyTemplatesRealizedAvgPrices,
  getMyTemplatesRevenueSeries30d,
  getMyTemplatesBuyRentSummary,
  getPlatformStats,
  getPlatformStatsByCategory,
  getPlatformRealizedAvgPrices,
};
