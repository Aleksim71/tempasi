// src/web/routes/admin.pages.routes.cjs
// Admin pages (SSR). Follows the cabinet.pages.routes.cjs convention:
// no-arg factory, own pool via scripts/db.pool.cjs (the {db} passed from
// app.js is accepted for call-site consistency but not required).
'use strict';

const express = require('express');

const { getPool } = require('../../../scripts/db.pool.cjs');

const ALLOWED_PERIOD_DAYS = new Set([1, 7, 28]);
const DEFAULT_PERIOD_DAYS = 7;

function parsePeriodDays(raw) {
  const n = Number.parseInt(raw, 10);
  return ALLOWED_PERIOD_DAYS.has(n) ? n : DEFAULT_PERIOD_DAYS;
}

function formatEurFromCents(cents) {
  const n = Number(cents || 0);
  return (n / 100).toFixed(2);
}

// Формат: "+12", "\u221203" (unicode minus), "0"
function formatSignedCount(delta) {
  const n = Math.trunc(Number(delta || 0));
  if (n > 0) return `+${n}`;
  if (n < 0) return `\u2212${Math.abs(n)}`;
  return '0';
}

function formatSignedEur(deltaCents) {
  const n = Number(deltaCents || 0);
  const abs = formatEurFromCents(Math.abs(n));
  if (n > 0) return `+${abs}`;
  if (n < 0) return `\u2212${abs}`;
  return abs;
}

function deltaSign(n) {
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

// Same convention as cabinet.pages.routes.cjs / cart.routes.js.
function formatDateYMD(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function formatEurOrDash(cents) {
  if (cents === null || cents === undefined) return '\u2014';
  return `\u20ac${formatEurFromCents(cents)}`;
}

// Accepts 'YYYY-MM-DD' from a <input type="date">; returns null if absent/invalid.
function parseDateParam(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? raw : null;
}

const TEMPLATES_PAGE_SIZE = 25;

function parsePage(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Сумма paid-заказов заданного deal_type за последние periodDays дней,
// плюс сумма за предыдущий период такой же длины (для дельты в деньгах).
async function getRevenueWindow(pool, dealType, periodDays) {
  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(SUM(amount_cents) FILTER (
        WHERE created_at >= NOW() - make_interval(days => $2::int)
      ), 0)::bigint AS current_cents,
      COALESCE(SUM(amount_cents) FILTER (
        WHERE created_at >= NOW() - make_interval(days => $2::int * 2)
          AND created_at <  NOW() - make_interval(days => $2::int)
      ), 0)::bigint AS previous_cents
    FROM orders
    WHERE deal_type = $1 AND status = 'paid'
      AND created_at >= NOW() - make_interval(days => $2::int * 2)
    `,
    [dealType, periodDays],
  );

  const currentCents = Number(rows[0]?.current_cents || 0);
  const previousCents = Number(rows[0]?.previous_cents || 0);
  return { currentCents, previousCents, deltaCents: currentCents - previousCents };
}

async function getDashboardKpis(periodDays) {
  const pool = getPool();

  const [usersTotalRes, usersNewRes, templatesTotalRes, templatesNetRes, rent, buy] =
    await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM users`),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM users
          WHERE created_at >= NOW() - make_interval(days => $1::int)`,
        [periodDays],
      ),
      // "Общее количество шаблонов" = только published (видные в каталоге).
      pool.query(
        `SELECT COUNT(*)::int AS n FROM seller_templates
          WHERE status = 'published' AND deleted_at IS NULL`,
      ),
      // Netto-изменение за период: вновь опубликованные минус удалённые.
      // Ограничение: смена статуса published -> draft без удаления записи
      // здесь не отражается — в схеме нет истории статусов. Как только
      // Этап 2 начнёт писать такие переходы в admin_audit_log, дельту
      // можно будет считать точнее.
      pool.query(
        `
        SELECT
          (
            SELECT COUNT(*)::int FROM seller_templates
            WHERE status = 'published' AND deleted_at IS NULL
              AND created_at >= NOW() - make_interval(days => $1::int)
          ) -
          (
            SELECT COUNT(*)::int FROM seller_templates
            WHERE deleted_at >= NOW() - make_interval(days => $1::int)
          ) AS n
        `,
        [periodDays],
      ),
      getRevenueWindow(pool, 'RENT', periodDays),
      getRevenueWindow(pool, 'BUY', periodDays),
    ]);

  const usersTotal = usersTotalRes.rows[0]?.n || 0;
  const usersNew = usersNewRes.rows[0]?.n || 0;
  const templatesTotal = templatesTotalRes.rows[0]?.n || 0;
  const templatesNet = templatesNetRes.rows[0]?.n || 0;

  return {
    users: {
      label: 'Users',
      total: usersTotal,
      delta: formatSignedCount(usersNew),
      deltaSign: deltaSign(usersNew),
    },
    templates: {
      label: 'Templates (published)',
      total: templatesTotal,
      delta: formatSignedCount(templatesNet),
      deltaSign: deltaSign(templatesNet),
    },
    rent: {
      label: 'Revenue \u00b7 rent',
      totalEur: formatEurFromCents(rent.currentCents),
      delta: formatSignedEur(rent.deltaCents),
      deltaSign: deltaSign(rent.deltaCents),
    },
    buy: {
      label: 'Revenue \u00b7 sale',
      totalEur: formatEurFromCents(buy.currentCents),
      delta: formatSignedEur(buy.deltaCents),
      deltaSign: deltaSign(buy.deltaCents),
    },
  };
}

const TEMPLATE_STATUS_FILTERS = new Set(['draft', 'published']);
const TEMPLATE_SOLD_FILTERS = new Set(['sold', 'not_sold']);

async function getTemplateCategories() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT category FROM seller_templates
      WHERE deleted_at IS NULL
      ORDER BY category ASC`,
  );
  return rows.map((r) => r.category);
}

// Read-only cross-module report query (seller_templates + orders + user_profiles).
// Per PILGRIM isolation rule this is fine for admin reads; any WRITE to
// seller_templates must instead go through sellerTemplates.service.cjs.
async function listAdminTemplates(filters) {
  const pool = getPool();

  const conditions = ['st.deleted_at IS NULL'];
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.regFrom) conditions.push(`st.created_at >= ${addParam(filters.regFrom)}::date`);
  if (filters.regTo) conditions.push(`st.created_at < (${addParam(filters.regTo)}::date + INTERVAL '1 day')`);
  if (filters.modFrom) conditions.push(`st.updated_at >= ${addParam(filters.modFrom)}::date`);
  if (filters.modTo) conditions.push(`st.updated_at < (${addParam(filters.modTo)}::date + INTERVAL '1 day')`);
  if (filters.category) conditions.push(`st.category = ${addParam(filters.category)}`);
  if (filters.status) conditions.push(`st.status = ${addParam(filters.status)}`);
  if (filters.owner) {
    const p = addParam(`%${filters.owner}%`);
    conditions.push(`(u.email ILIKE ${p} OR up.full_name ILIKE ${p} OR up.nickname ILIKE ${p})`);
  }
  if (filters.q) {
    const p = addParam(`%${filters.q}%`);
    conditions.push(`(st.title ILIKE ${p} OR st.slug ILIKE ${p})`);
  }
  if (filters.sold === 'sold') {
    conditions.push(
      `EXISTS (SELECT 1 FROM orders o WHERE o.template_slug = st.slug AND o.deal_type = 'BUY' AND o.status = 'paid')`,
    );
  } else if (filters.sold === 'not_sold') {
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM orders o WHERE o.template_slug = st.slug AND o.deal_type = 'BUY' AND o.status = 'paid')`,
    );
  }

  const whereSql = conditions.join(' AND ');

  const countRes = await pool.query(
    `
    SELECT COUNT(*)::int AS n
    FROM seller_templates st
    JOIN users u ON u.id = st.owner_user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE ${whereSql}
    `,
    params,
  );
  const total = countRes.rows[0]?.n || 0;

  const limitParam = addParam(TEMPLATES_PAGE_SIZE);
  const offsetParam = addParam((filters.page - 1) * TEMPLATES_PAGE_SIZE);

  const rowsRes = await pool.query(
    `
    SELECT
      st.id, st.slug, st.title, st.preview_image, st.preview_url,
      st.created_at, st.updated_at, st.price_buy_cents, st.price_rent_cents,
      st.status,
      COALESCE(NULLIF(TRIM(up.nickname), ''), NULLIF(TRIM(up.full_name), ''), u.email) AS owner_display,
      EXISTS (
        SELECT 1 FROM orders o
        WHERE o.template_slug = st.slug AND o.deal_type = 'BUY' AND o.status = 'paid'
      ) AS is_sold
    FROM seller_templates st
    JOIN users u ON u.id = st.owner_user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE ${whereSql}
    ORDER BY st.created_at DESC, st.id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    params,
  );

  return { rows: rowsRes.rows, total };
}

function buildFilterQueryString(filters) {
  const qs = new URLSearchParams();
  if (filters.regFrom) qs.set('regFrom', filters.regFrom);
  if (filters.regTo) qs.set('regTo', filters.regTo);
  if (filters.modFrom) qs.set('modFrom', filters.modFrom);
  if (filters.modTo) qs.set('modTo', filters.modTo);
  if (filters.category) qs.set('category', filters.category);
  if (filters.status) qs.set('status', filters.status);
  if (filters.owner) qs.set('owner', filters.owner);
  if (filters.q) qs.set('q', filters.q);
  if (filters.sold) qs.set('sold', filters.sold);
  return qs;
}

function createAdminPagesRouter() {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const periodDays = parsePeriodDays(req.query.period);
      const kpis = await getDashboardKpis(periodDays);

      return res.status(200).render('pages/admin/dashboard', {
        title: 'Admin \u00b7 Dashboard',
        bodyClass: 'admin',
        isAdmin: true,
        currentPage: 'dashboard',
        periodDays,
        periods: [1, 7, 28].map((days) => ({
          days,
          label: days === 1 ? '1 day' : days === 7 ? '7 days' : '28 days',
          active: days === periodDays,
        })),
        kpis,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/templates', async (req, res, next) => {
    try {
      const q = req.query || {};
      const filters = {
        regFrom: parseDateParam(q.regFrom),
        regTo: parseDateParam(q.regTo),
        modFrom: parseDateParam(q.modFrom),
        modTo: parseDateParam(q.modTo),
        category: typeof q.category === 'string' && q.category.trim() ? q.category.trim() : null,
        status: TEMPLATE_STATUS_FILTERS.has(q.status) ? q.status : null,
        owner: typeof q.owner === 'string' && q.owner.trim() ? q.owner.trim() : null,
        q: typeof q.q === 'string' && q.q.trim() ? q.q.trim() : null,
        sold: TEMPLATE_SOLD_FILTERS.has(q.sold) ? q.sold : null,
        page: parsePage(q.page),
      };

      const [categories, { rows, total }] = await Promise.all([
        getTemplateCategories(),
        listAdminTemplates(filters),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / TEMPLATES_PAGE_SIZE));
      const filterQs = buildFilterQueryString(filters);
      const hrefForPage = (p) => {
        const qs = new URLSearchParams(filterQs);
        qs.set('page', String(p));
        return `/admin/templates?${qs.toString()}`;
      };

      const templates = rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        previewSrc: r.preview_image || r.preview_url || null,
        createdLabel: formatDateYMD(r.created_at),
        updatedLabel: formatDateYMD(r.updated_at),
        priceBuyLabel: formatEurOrDash(r.price_buy_cents),
        priceRentLabel: formatEurOrDash(r.price_rent_cents),
        ownerDisplay: r.owner_display,
        statusLabel: r.status === 'published' ? 'Published' : 'Draft',
        statusSlug: r.status,
        isSold: r.is_sold,
        soldLabel: r.is_sold ? 'Sold' : 'Available',
      }));

      return res.status(200).render('pages/admin/templates', {
        title: 'Admin \u00b7 Templates',
        bodyClass: 'admin',
        isAdmin: true,
        currentPage: 'templates',
        filters: {
          regFrom: filters.regFrom || '',
          regTo: filters.regTo || '',
          modFrom: filters.modFrom || '',
          modTo: filters.modTo || '',
          category: filters.category || '',
          owner: filters.owner || '',
          q: filters.q || '',
        },
        statusOptions: [
          { value: '', label: 'All', selected: !filters.status },
          { value: 'published', label: 'Published', selected: filters.status === 'published' },
          { value: 'draft', label: 'Draft', selected: filters.status === 'draft' },
        ],
        soldOptions: [
          { value: '', label: 'All', selected: !filters.sold },
          { value: 'sold', label: 'Sold', selected: filters.sold === 'sold' },
          { value: 'not_sold', label: 'Not sold', selected: filters.sold === 'not_sold' },
        ],
        categoryOptions: [
          { value: '', label: 'All', selected: !filters.category },
          ...categories.map((c) => ({ value: c, label: c, selected: c === filters.category })),
        ],
        templates,
        total,
        page: filters.page,
        totalPages,
        hasPrev: filters.page > 1,
        hasNext: filters.page < totalPages,
        prevHref: hrefForPage(Math.max(1, filters.page - 1)),
        nextHref: hrefForPage(Math.min(totalPages, filters.page + 1)),
      });
    } catch (err) {
      return next(err);
    }
  });

  // Still stubs — Users/Finance land later.
  router.get('/users', (req, res) => {
    return res.status(200).render('pages/admin/users', {
      title: 'Admin \u00b7 Users',
      bodyClass: 'admin',
      isAdmin: true,
      currentPage: 'users',
    });
  });

  router.get('/finance', (req, res) => {
    return res.status(200).render('pages/admin/finance', {
      title: 'Admin \u00b7 Finance',
      bodyClass: 'admin',
      isAdmin: true,
      currentPage: 'finance',
    });
  });

  return router;
}

module.exports = { createAdminPagesRouter };
