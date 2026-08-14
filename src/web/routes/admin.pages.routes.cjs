// src/web/routes/admin.pages.routes.cjs
// Admin pages (SSR). Follows the cabinet.pages.routes.cjs convention:
// no-arg factory, own pool via scripts/db.pool.cjs (the {db} passed from
// app.js is accepted for call-site consistency but not required).
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const { getPool } = require('../../../scripts/db.pool.cjs');
const sellerTemplatesService = require('../../modules/templates/sellerTemplates.service.cjs');
const { checkTemplateStorage } = require('../../modules/storage/templateStorageCheck.cjs');

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

function formatBytesForBackup(bytes) {
  if (!Number.isFinite(bytes)) return '\u2014';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
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

async function getAvgCheckWindow(pool, dealType, periodDays) {
  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(ROUND(AVG(amount_cents) FILTER (
        WHERE created_at >= NOW() - make_interval(days => $2::int)
      )), 0)::bigint AS current_cents,
      COALESCE(ROUND(AVG(amount_cents) FILTER (
        WHERE created_at >= NOW() - make_interval(days => $2::int * 2)
          AND created_at <  NOW() - make_interval(days => $2::int)
      )), 0)::bigint AS previous_cents
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

  const [usersTotalRes, usersNewRes, templatesTotalRes, templatesNetRes, rent, buy, avgRent, avgBuy] =
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
      getAvgCheckWindow(pool, 'RENT', periodDays),
      getAvgCheckWindow(pool, 'BUY', periodDays),
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
    avgRent: {
      label: 'Avg check \u00b7 rent',
      totalEur: formatEurFromCents(avgRent.currentCents),
      delta: formatSignedEur(avgRent.deltaCents),
      deltaSign: deltaSign(avgRent.deltaCents),
    },
    avgSale: {
      label: 'Avg check \u00b7 sale',
      totalEur: formatEurFromCents(avgBuy.currentCents),
      delta: formatSignedEur(avgBuy.deltaCents),
      deltaSign: deltaSign(avgBuy.deltaCents),
    },
  };
}

const TEMPLATE_STATUS_FILTERS = new Set(['draft', 'published', 'blocked']);
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
  if (filters.status === 'blocked') {
    conditions.push('st.admin_blocked_at IS NOT NULL');
  } else if (filters.status) {
    conditions.push(`st.status = ${addParam(filters.status)}`);
  }
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
      st.status, st.admin_blocked_at,
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

const USERS_PAGE_SIZE = 25;

// Read-only cross-module report (users + user_profiles + orders +
// seller_templates). Same isolation rule as Templates: fine for reads,
// any WRITE would need to go through the owning module instead.
async function listAdminUsers(filters) {
  const pool = getPool();

  const conditions = [];
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.regFrom) conditions.push(`u.created_at >= ${addParam(filters.regFrom)}::date`);
  if (filters.regTo) conditions.push(`u.created_at < (${addParam(filters.regTo)}::date + INTERVAL '1 day')`);

  const isBuyerSql = `EXISTS (SELECT 1 FROM orders bo WHERE bo.user_id = u.id AND bo.status = 'paid')`;
  const isSellerSql = `EXISTS (
    SELECT 1 FROM orders so
    JOIN seller_templates st ON st.slug = so.template_slug
    WHERE st.owner_user_id = u.id AND so.status = 'paid'
  )`;

  const categoryConditions = [];
  if (filters.empty) categoryConditions.push(`(NOT ${isBuyerSql} AND NOT ${isSellerSql})`);
  if (filters.buyers) categoryConditions.push(isBuyerSql);
  if (filters.sellers) categoryConditions.push(isSellerSql);
  if (categoryConditions.length) conditions.push(`(${categoryConditions.join(' OR ')})`);

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users u ${whereSql}`,
    params,
  );
  const total = countRes.rows[0]?.n || 0;

  const limitParam = addParam(USERS_PAGE_SIZE);
  const offsetParam = addParam((filters.page - 1) * USERS_PAGE_SIZE);

  const rowsRes = await pool.query(
    `
    SELECT
      u.id, u.email, u.role, u.status, u.created_at,
      COALESCE(NULLIF(TRIM(up.nickname), ''), NULLIF(TRIM(up.full_name), ''), u.email) AS display_name,
      (
        SELECT COUNT(*) FROM orders so
        JOIN seller_templates st ON st.slug = so.template_slug
        WHERE st.owner_user_id = u.id AND so.deal_type = 'BUY' AND so.status = 'paid'
      )::int AS sold_buy_count,
      (
        SELECT COUNT(*) FROM orders so
        JOIN seller_templates st ON st.slug = so.template_slug
        WHERE st.owner_user_id = u.id AND so.deal_type = 'RENT' AND so.status = 'paid'
      )::int AS sold_rent_count,
      (
        SELECT COUNT(*) FROM orders bo
        WHERE bo.user_id = u.id AND bo.deal_type = 'BUY' AND bo.status = 'paid'
      )::int AS bought_buy_count,
      (
        SELECT COUNT(*) FROM orders bo
        WHERE bo.user_id = u.id AND bo.deal_type = 'RENT' AND bo.status = 'paid'
      )::int AS bought_rent_count
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    ${whereSql}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    params,
  );

  return { rows: rowsRes.rows, total };
}

function buildUsersFilterQueryString(filters) {
  const qs = new URLSearchParams();
  if (filters.regFrom) qs.set('regFrom', filters.regFrom);
  if (filters.regTo) qs.set('regTo', filters.regTo);
  if (filters.empty) qs.set('empty', '1');
  if (filters.buyers) qs.set('buyers', '1');
  if (filters.sellers) qs.set('sellers', '1');
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
        statusLabel: r.admin_blocked_at ? 'Blocked' : r.status === 'published' ? 'Published' : 'Draft',
        statusSlug: r.admin_blocked_at ? 'blocked' : r.status,
        isBlocked: Boolean(r.admin_blocked_at),
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
          { value: 'blocked', label: 'Blocked', selected: filters.status === 'blocked' },
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
        currentHref: hrefForPage(filters.page),
      });
    } catch (err) {
      return next(err);
    }
  });

  function safeReturnTo(raw) {
    return typeof raw === 'string' && raw.startsWith('/admin/templates') ? raw : '/admin/templates';
  }

  function resolveActorUserId(req) {
    return (
      req?.user?.id ??
      req?.user?.user_id ??
      req?.user?.userId ??
      req?.userId ??
      req?.session?.userId ??
      req?.session?.user_id ??
      null
    );
  }

  // Write path for block/unblock goes through sellerTemplates.service.cjs
  // (the owning module), not raw SQL here — per the isolation rule.
  // Only the admin_audit_log INSERT (owned by this module) happens directly.
  router.post('/templates/:id/block', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();
    const id = Number(req.params.id);
    const returnTo = safeReturnTo(req.body?.returnTo);
    try {
      const { updated } = await sellerTemplatesService.adminBlockTemplate({ pool, id });
      await pool.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
         VALUES ($1, 'template_block', 'seller_template', $2, $3::jsonb)`,
        [resolveActorUserId(req), String(id), JSON.stringify({ slug: updated.slug })],
      );
    } catch (err) {
      if (err && err.code === 'NOT_FOUND') return res.redirect(returnTo);
      return next(err);
    }
    return res.redirect(returnTo);
  });

  router.post('/templates/:id/unblock', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();
    const id = Number(req.params.id);
    const returnTo = safeReturnTo(req.body?.returnTo);
    try {
      const { updated } = await sellerTemplatesService.adminUnblockTemplate({ pool, id });
      await pool.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
         VALUES ($1, 'template_unblock', 'seller_template', $2, $3::jsonb)`,
        [resolveActorUserId(req), String(id), JSON.stringify({ slug: updated.slug })],
      );
    } catch (err) {
      if (err && err.code === 'NOT_FOUND') return res.redirect(returnTo);
      return next(err);
    }
    return res.redirect(returnTo);
  });

  router.post('/templates/:id/delete', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();
    const id = Number(req.params.id);
    const returnTo = safeReturnTo(req.body?.returnTo);
    try {
      const { deleted } = await sellerTemplatesService.adminDeleteTemplate({ pool, id });
      await pool.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
         VALUES ($1, 'template_delete', 'seller_template', $2, $3::jsonb)`,
        [resolveActorUserId(req), String(id), JSON.stringify({ slug: deleted.slug })],
      );
    } catch (err) {
      if (err && err.code === 'NOT_FOUND') return res.redirect(returnTo);
      return next(err);
    }
    return res.redirect(returnTo);
  });

  // ---- Trash (soft-deleted templates: restore, or delete forever) ----
  router.get('/trash', async (req, res, next) => {
    const pool = getPool();
    try {
      const page = parsePage(req.query.page);
      const { items, total, pageSize } = await sellerTemplatesService.adminListTrash({ pool, page });
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      const templates = items.map((r) => ({
        id: r.id,
        title: r.title,
        ownerDisplay: r.owner_display,
        deletedAtLabel: formatDateYMD(r.deleted_at),
      }));

      const currentHref = `/admin/trash?page=${page}`;

      res.render('pages/admin/trash', {
        title: 'Admin \u00b7 Trash',
        bodyClass: 'admin',
        isAdmin: true,
        currentPage: 'templates',
        templates,
        total,
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevHref: `/admin/trash?page=${Math.max(1, page - 1)}`,
        nextHref: `/admin/trash?page=${Math.min(totalPages, page + 1)}`,
        currentHref,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/trash/:id/restore', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();
    const id = Number(req.params.id);
    const returnTo = safeReturnTo(req.body?.returnTo) || '/admin/trash';
    try {
      const { restored } = await sellerTemplatesService.adminRestoreTemplate({ pool, id });
      await pool.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
         VALUES ($1, 'template_restore', 'seller_template', $2, $3::jsonb)`,
        [resolveActorUserId(req), String(id), JSON.stringify({ slug: restored.slug })],
      );
    } catch (err) {
      if (err && err.code === 'NOT_FOUND') return res.redirect(returnTo);
      return next(err);
    }
    return res.redirect(returnTo);
  });

  router.post('/trash/:id/purge', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();
    const id = Number(req.params.id);
    const returnTo = safeReturnTo(req.body?.returnTo) || '/admin/trash';
    try {
      const { deleted } = await sellerTemplatesService.adminPurgeTemplate({ pool, id });
      await pool.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
         VALUES ($1, 'template_purge', 'seller_template', $2, $3::jsonb)`,
        [resolveActorUserId(req), String(id), JSON.stringify({ slug: deleted.slug })],
      );
    } catch (err) {
      if (err && err.code === 'NOT_FOUND') return res.redirect(returnTo);
      return next(err);
    }
    return res.redirect(returnTo);
  });

  // Still stubs — Users/Finance/Settings/Security land later.
  router.get('/users', async (req, res, next) => {
    try {
      const q = req.query || {};
      const filters = {
        regFrom: parseDateParam(q.regFrom),
        regTo: parseDateParam(q.regTo),
        empty: q.empty === '1',
        buyers: q.buyers === '1',
        sellers: q.sellers === '1',
        page: parsePage(q.page),
      };

      const { rows, total } = await listAdminUsers(filters);
      const totalPages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
      const filterQs = buildUsersFilterQueryString(filters);
      const hrefForPage = (p) => {
        const qs = new URLSearchParams(filterQs);
        qs.set('page', String(p));
        return `/admin/users?${qs.toString()}`;
      };

      const users = rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        role: r.role,
        status: r.status,
        registeredLabel: formatDateYMD(r.created_at),
        soldBuyCount: r.sold_buy_count,
        soldRentCount: r.sold_rent_count,
        boughtBuyCount: r.bought_buy_count,
        boughtRentCount: r.bought_rent_count,
      }));

      return res.status(200).render('pages/admin/users', {
        title: 'Admin \u00b7 Users',
        bodyClass: 'admin',
        isAdmin: true,
        currentPage: 'users',
        filters: {
          regFrom: filters.regFrom || '',
          regTo: filters.regTo || '',
        },
        checkboxes: {
          empty: filters.empty,
          buyers: filters.buyers,
          sellers: filters.sellers,
        },
        users,
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

  router.get('/finance', (req, res) => {
    return res.redirect('/admin/finance/catalog');
  });

  // ---- Finance > Catalog (revenue per catalog theme) ----
  router.get('/finance/catalog', async (req, res, next) => {
    const pool = getPool();
    try {
      const regFrom = parseDateParam(req.query.regFrom);
      const regTo = parseDateParam(req.query.regTo);

      const params = [];
      const addParam = (v) => {
        params.push(v);
        return `$${params.length}`;
      };
      let dateSql = '';
      if (regFrom) dateSql += ` AND o.created_at >= ${addParam(regFrom)}::date`;
      if (regTo) dateSql += ` AND o.created_at < (${addParam(regTo)}::date + INTERVAL '1 day')`;

      const { rows } = await pool.query(
        `
        SELECT
          cc.id, cc.slug, cc.label,
          COALESCE(SUM(o.amount_cents) FILTER (WHERE o.deal_type = 'RENT'), 0)::bigint AS rent_cents,
          COALESCE(SUM(o.amount_cents) FILTER (WHERE o.deal_type = 'BUY'), 0)::bigint AS sale_cents
        FROM catalog_categories cc
        LEFT JOIN seller_templates st ON st.category = cc.slug AND st.deleted_at IS NULL
        LEFT JOIN orders o ON o.template_slug = st.slug AND o.status = 'paid' ${dateSql}
        GROUP BY cc.id, cc.slug, cc.label
        ORDER BY (COALESCE(SUM(o.amount_cents) FILTER (WHERE o.deal_type = 'RENT'), 0)
                + COALESCE(SUM(o.amount_cents) FILTER (WHERE o.deal_type = 'BUY'), 0)) DESC,
                cc.label ASC
        `,
        params,
      );

      const categories = rows.map((r) => ({
        label: r.label,
        slug: r.slug,
        rentLabel: formatEurFromCents(Number(r.rent_cents)),
        saleLabel: formatEurFromCents(Number(r.sale_cents)),
        totalLabel: formatEurFromCents(Number(r.rent_cents) + Number(r.sale_cents)),
      }));

      return res.status(200).render('pages/admin/finance/catalog', {
        title: 'Admin \u00b7 Finance \u00b7 Catalog',
        bodyClass: 'admin',
        isAdmin: true,
        currentPage: 'finance',
        financeTab: 'catalog',
        filters: { regFrom: regFrom || '', regTo: regTo || '' },
        categories,
      });
    } catch (err) {
      return next(err);
    }
  });

  // ---- Finance > Users (revenue per seller) ----
  const FINANCE_USERS_PAGE_SIZE = 25;

  router.get('/finance/users', async (req, res, next) => {
    const pool = getPool();
    try {
      const regFrom = parseDateParam(req.query.regFrom);
      const regTo = parseDateParam(req.query.regTo);
      const page = parsePage(req.query.page);

      const params = [];
      const addParam = (v) => {
        params.push(v);
        return `$${params.length}`;
      };
      let dateSql = '';
      if (regFrom) dateSql += ` AND o.created_at >= ${addParam(regFrom)}::date`;
      if (regTo) dateSql += ` AND o.created_at < (${addParam(regTo)}::date + INTERVAL '1 day')`;

      const countRes = await pool.query('SELECT COUNT(*)::int AS n FROM users');
      const total = countRes.rows[0]?.n || 0;
      const totalPages = Math.max(1, Math.ceil(total / FINANCE_USERS_PAGE_SIZE));

      const limitParam = addParam(FINANCE_USERS_PAGE_SIZE);
      const offsetParam = addParam((page - 1) * FINANCE_USERS_PAGE_SIZE);

      const { rows } = await pool.query(
        `
        SELECT
          u.id, u.email,
          COALESCE(NULLIF(TRIM(up.nickname), ''), NULLIF(TRIM(up.full_name), ''), u.email) AS display_name,
          COALESCE(SUM(o.amount_cents) FILTER (WHERE o.deal_type = 'RENT'), 0)::bigint AS rent_cents,
          COALESCE(SUM(o.amount_cents) FILTER (WHERE o.deal_type = 'BUY'), 0)::bigint AS sale_cents
        FROM users u
        LEFT JOIN user_profiles up ON up.user_id = u.id
        LEFT JOIN seller_templates st ON st.owner_user_id = u.id AND st.deleted_at IS NULL
        LEFT JOIN orders o ON o.template_slug = st.slug AND o.status = 'paid' ${dateSql}
        GROUP BY u.id, u.email, up.nickname, up.full_name
        ORDER BY (COALESCE(SUM(o.amount_cents) FILTER (WHERE o.deal_type = 'RENT'), 0)
                + COALESCE(SUM(o.amount_cents) FILTER (WHERE o.deal_type = 'BUY'), 0)) DESC,
                u.id DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
        `,
        params,
      );

      const users = rows.map((r) => ({
        displayName: r.display_name,
        email: r.email,
        rentLabel: formatEurFromCents(Number(r.rent_cents)),
        saleLabel: formatEurFromCents(Number(r.sale_cents)),
        totalLabel: formatEurFromCents(Number(r.rent_cents) + Number(r.sale_cents)),
      }));

      const filterQs = new URLSearchParams();
      if (regFrom) filterQs.set('regFrom', regFrom);
      if (regTo) filterQs.set('regTo', regTo);
      const hrefForPage = (p) => {
        const qs = new URLSearchParams(filterQs);
        qs.set('page', String(p));
        return `/admin/finance/users?${qs.toString()}`;
      };

      return res.status(200).render('pages/admin/finance/users', {
        title: 'Admin \u00b7 Finance \u00b7 Users',
        bodyClass: 'admin',
        isAdmin: true,
        currentPage: 'finance',
        financeTab: 'users',
        filters: { regFrom: regFrom || '', regTo: regTo || '' },
        users,
        total,
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevHref: hrefForPage(Math.max(1, page - 1)),
        nextHref: hrefForPage(Math.min(totalPages, page + 1)),
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/settings', (req, res) => {
    return res.redirect('/admin/settings/catalog');
  });

  function slugifyLabel(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function resolveActorUserIdForSettings(req) {
    return (
      req?.user?.id ??
      req?.user?.user_id ??
      req?.user?.userId ??
      req?.userId ??
      req?.session?.userId ??
      req?.session?.user_id ??
      null
    );
  }

  // ---- Settings > Catalog ----
  router.get('/settings/catalog', async (req, res, next) => {
    const pool = getPool();
    try {
      const { rows } = await pool.query(
        `
        SELECT
          cc.id, cc.slug, cc.label, cc.created_at,
          (SELECT COUNT(*) FROM seller_templates st WHERE st.category = cc.slug AND st.deleted_at IS NULL)::int AS in_use_count
        FROM catalog_categories cc
        ORDER BY cc.label ASC
        `,
      );
      return res.status(200).render('pages/admin/settings/catalog', {
        title: 'Admin \u00b7 Settings \u00b7 Catalog',
        bodyClass: 'admin',
        isAdmin: true,
        currentPage: 'settings',
        settingsTab: 'catalog',
        categories: rows,
        error: req.query.error || null,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/settings/catalog', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();
    const label = String(req.body?.label || '').trim();
    const slug = slugifyLabel(label);

    if (!label || !slug) {
      return res.redirect('/admin/settings/catalog?error=' + encodeURIComponent('Label is required.'));
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO catalog_categories (slug, label)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [slug, label],
      );
      if (!rows[0]) {
        return res.redirect('/admin/settings/catalog?error=' + encodeURIComponent('That category already exists.'));
      }
      await pool.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
         VALUES ($1, 'catalog_category_add', 'catalog_category', $2, $3::jsonb)`,
        [resolveActorUserIdForSettings(req), String(rows[0].id), JSON.stringify({ slug, label })],
      );
    } catch (err) {
      return next(err);
    }
    return res.redirect('/admin/settings/catalog');
  });

  router.post('/settings/catalog/:id/delete', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();
    const id = Number(req.params.id);

    try {
      const { rows } = await pool.query('SELECT slug, label FROM catalog_categories WHERE id = $1', [id]);
      const target = rows[0];
      if (!target) return res.redirect('/admin/settings/catalog');

      if (target.slug === 'other') {
        return res.redirect(
          '/admin/settings/catalog?error=' + encodeURIComponent('"Other" cannot be deleted — it is the fallback category.'),
        );
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Reassign templates in the deleted theme to "Other" (bottom of
        // the seller's category list) rather than leaving them orphaned.
        await client.query(
          `UPDATE seller_templates SET category = 'other', updated_at = NOW() WHERE category = $1`,
          [target.slug],
        );
        await client.query('DELETE FROM catalog_categories WHERE id = $1', [id]);
        await client.query(
          `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
           VALUES ($1, 'catalog_category_delete', 'catalog_category', $2, $3::jsonb)`,
          [resolveActorUserIdForSettings(req), String(id), JSON.stringify({ slug: target.slug, label: target.label })],
        );
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      return next(err);
    }
    return res.redirect('/admin/settings/catalog');
  });

  // ---- Settings > Commission fee ----
  router.get('/settings/commission', async (req, res, next) => {
    const pool = getPool();
    try {
      const { rows } = await pool.query('SELECT rent_percent, sale_percent, updated_at FROM commission_settings WHERE id = 1');
      const row = rows[0] || { rent_percent: 0, sale_percent: 0, updated_at: null };
      return res.status(200).render('pages/admin/settings/commission', {
        title: 'Admin \u00b7 Settings \u00b7 Commission fee',
        bodyClass: 'admin',
        isAdmin: true,
        currentPage: 'settings',
        settingsTab: 'commission',
        rentPercent: row.rent_percent,
        salePercent: row.sale_percent,
        updatedLabel: row.updated_at ? formatDateYMD(row.updated_at) : null,
        error: req.query.error || null,
        saved: req.query.saved === '1',
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/settings/commission', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();
    const rentPercent = Number.parseFloat(req.body?.rentPercent);
    const salePercent = Number.parseFloat(req.body?.salePercent);

    const valid = (n) => Number.isFinite(n) && n >= 0 && n <= 100;
    if (!valid(rentPercent) || !valid(salePercent)) {
      return res.redirect(
        '/admin/settings/commission?error=' + encodeURIComponent('Both percentages must be between 0 and 100.'),
      );
    }

    try {
      await pool.query(
        `UPDATE commission_settings
         SET rent_percent = $1, sale_percent = $2, updated_at = NOW(), updated_by = $3
         WHERE id = 1`,
        [rentPercent, salePercent, resolveActorUserIdForSettings(req)],
      );
      await pool.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
         VALUES ($1, 'commission_settings_update', 'commission_settings', '1', $2::jsonb)`,
        [resolveActorUserIdForSettings(req), JSON.stringify({ rentPercent, salePercent })],
      );
    } catch (err) {
      return next(err);
    }
    return res.redirect('/admin/settings/commission?saved=1');
  });

  // ---- Settings > Backup ----
  // TEMPASI_FULL_BACKUP (2026-08-14): the automatic (cron) backup can
  // be toggled on/off here (a flag file backup-full.sh checks before
  // running), and "Run backup now" runs the same combined backup
  // (templates + DB dump + manifest) synchronously, no downtime.
  const PROJECT_ROOT = path.resolve(__dirname, '../../..');
  const BACKUP_DISABLED_FLAG = path.join(PROJECT_ROOT, '.backup-automatic-disabled');
  // TEMPASI_RESTORE_PROTOCOL (2026-08-14): only files matching this
  // exact naming pattern (as written by backup-db.sh) are ever passed
  // to restore-full.sh — blocks path traversal / arbitrary shell args
  // even though spawn() with an argv array already avoids shell
  // interpolation on its own. Defense in depth.
  const DUMP_NAME_PATTERN = /^tempasi_\d{8}_\d{6}\.sql\.gz$/;

  router.get('/settings/backup', (req, res) => {
    const configuredDir = process.env.BACKUP_DIR;
    const backupDir = configuredDir ? path.resolve(configuredDir) : null;

    let files = [];
    let dirExists = false;
    let dirError = null;
    let restorablePairs = [];

    if (backupDir) {
      try {
        dirExists = fs.existsSync(backupDir);
        if (dirExists) {
          const rawNames = fs.readdirSync(backupDir).filter((name) => !name.startsWith('.'));

          files = rawNames
            .map((name) => {
              const stat = fs.statSync(path.join(backupDir, name));
              return {
                name,
                sizeLabel: formatBytesForBackup(stat.size),
                modifiedLabel: formatDateYMD(stat.mtime),
                modifiedTs: stat.mtime.getTime(),
              };
            })
            .sort((a, b) => b.modifiedTs - a.modifiedTs);

          // A dump is only offered for restore if it has a matching
          // manifest \u2014 see backup-full.sh / restore-full.sh: the
          // manifest is what pairs a DB dump with the exact templates
          // snapshot taken alongside it, and restore-full.sh itself
          // refuses to run without one.
          const nameSet = new Set(rawNames);
          restorablePairs = rawNames
            .filter((name) => DUMP_NAME_PATTERN.test(name))
            .filter((name) => nameSet.has(`${name.slice(0, -'.sql.gz'.length)}.manifest.json`))
            .map((name) => {
              const stat = fs.statSync(path.join(backupDir, name));
              return { name, modifiedLabel: formatDateYMD(stat.mtime), modifiedTs: stat.mtime.getTime() };
            })
            .sort((a, b) => b.modifiedTs - a.modifiedTs);
        }
      } catch (e) {
        dirError = e.message;
      }
    }

    return res.status(200).render('pages/admin/settings/backup', {
      title: 'Admin \u00b7 Settings \u00b7 Backup',
      bodyClass: 'admin',
      isAdmin: true,
      currentPage: 'settings',
      settingsTab: 'backup',
      backupDirConfigured: Boolean(backupDir),
      backupDir,
      dirExists,
      dirError,
      files,
      restorablePairs,
      automaticEnabled: !fs.existsSync(BACKUP_DISABLED_FLAG),
      toggled: req.query.toggled === '1',
      ranNow: req.query.ranNow === '1',
      error: req.query.error || null,
    });
  });

  router.post('/settings/backup/toggle', express.urlencoded({ extended: false }), (req, res) => {
    const enable = req.body?.enable === '1';
    try {
      if (enable) {
        if (fs.existsSync(BACKUP_DISABLED_FLAG)) fs.unlinkSync(BACKUP_DISABLED_FLAG);
      } else {
        fs.writeFileSync(BACKUP_DISABLED_FLAG, `disabled at ${new Date().toISOString()}\n`);
      }
    } catch (e) {
      return res.redirect(
        '/admin/settings/backup?error=' + encodeURIComponent(`Could not update the toggle: ${e.message}`),
      );
    }
    return res.redirect('/admin/settings/backup?toggled=1');
  });

  router.post('/settings/backup/run-now', (req, res) => {
    try {
      execFileSync('bash', [path.join(PROJECT_ROOT, 'scripts/backup-full.sh'), '--force'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 120000,
      });
      return res.redirect('/admin/settings/backup?ranNow=1');
    } catch (e) {
      const raw = String(e.stdout || e.message || e);
      const msg = raw.length > 500 ? `${raw.slice(0, 500)}\u2026` : raw;
      return res.redirect('/admin/settings/backup?error=' + encodeURIComponent(`Backup run failed: ${msg}`));
    }
  });

  // TEMPASI_RESTORE_PROTOCOL (2026-08-14): this is the single most
  // destructive action in the whole admin panel \u2014 it wipes and
  // reloads the live database, and can delete files on старичок in
  // --exact mode. The typed-exact-filename confirmation happens
  // client-side (backup.hbs) AND is re-checked here server-side
  // (never trust the client alone for something this destructive).
  // restore-full.sh is spawned fully detached: it stops this very
  // server process partway through its own run, so the request
  // handler cannot wait for it to finish \u2014 it responds immediately
  // and the script continues independently, logging to its own file.
  router.post('/settings/backup/restore', express.urlencoded({ extended: false }), (req, res) => {
    const dumpFile = String(req.body?.dumpFile || '').trim();
    const confirmFile = String(req.body?.confirmFile || '').trim();
    const mode = req.body?.mode === 'exact' ? 'exact' : 'additive';

    if (!DUMP_NAME_PATTERN.test(dumpFile)) {
      return res.redirect(
        '/admin/settings/backup?error=' + encodeURIComponent('Invalid dump filename. Nothing was restored.'),
      );
    }

    if (confirmFile !== dumpFile) {
      return res.redirect(
        '/admin/settings/backup?error=' +
          encodeURIComponent('Confirmation text did not match the dump filename exactly. Nothing was restored.'),
      );
    }

    const configuredDir = process.env.BACKUP_DIR;
    const backupDir = configuredDir ? path.resolve(configuredDir) : null;
    const manifestName = `${dumpFile.slice(0, -'.sql.gz'.length)}.manifest.json`;

    if (!backupDir || !fs.existsSync(path.join(backupDir, dumpFile)) || !fs.existsSync(path.join(backupDir, manifestName))) {
      return res.redirect(
        '/admin/settings/backup?error=' +
          encodeURIComponent('Dump or its manifest not found on disk. Nothing was restored.'),
      );
    }

    const args = [path.join(PROJECT_ROOT, 'scripts/restore-full.sh'), dumpFile];
    if (mode === 'exact') args.push('--exact');

    try {
      const child = spawn('bash', args, {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (e) {
      return res.redirect(
        '/admin/settings/backup?error=' + encodeURIComponent(`Could not start restore: ${e.message}`),
      );
    }

    return res.status(200).send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Restore started</title></head>
<body style="background:#0b0f14;color:#e7eefc;font-family:sans-serif;max-width:640px;margin:60px auto;padding:0 20px;">
  <h1>Restore started</h1>
  <p>Dump: <code>${dumpFile}</code></p>
  <p>Templates mode: <code>${mode}</code></p>
  <p>The site will stop in a few seconds, restore, and come back up on its own \u2014 usually under a minute.
     This page will not auto-reload. Reload <a href="/admin/settings/backup" style="color:#6aa7ff;">Settings &gt; Backup</a>
     yourself once the site is responding again.</p>
  <p>Full log: <code>logs/restore_*.log</code> on the server.</p>
</body></html>`);
  });

  router.get('/settings/storage', (req, res) => {
    const result = checkTemplateStorage();

    return res.status(200).render('pages/admin/settings/storage', {
      title: 'Admin \u00b7 Settings \u00b7 Storage',
      bodyClass: 'admin',
      isAdmin: true,
      currentPage: 'settings',
      settingsTab: 'storage',
      result,
      failMessage: {
        DIR_NOT_FOUND: 'This path does not exist. If it should be a mount (e.g. sshfs) to the storage machine, mount it there first.',
        STAT_FAILED: 'Could not read this path\u2019s filesystem info.',
        NOT_A_MOUNT: 'This path exists but is not a distinct mounted filesystem \u2014 it looks like a plain local directory, not the storage machine. The mount either was never set up, or it dropped (storage machine off/asleep/network issue), and writes since then have been landing on this server\u2019s local disk instead. Turn on the storage machine and (re)mount TEMPLATE_UPLOAD_DIR, then reload this page.',
        READ_WRITE_FAILED: 'A write/read check on this directory raised an error.',
        READ_WRITE_MISMATCH: 'Wrote a marker file but could not read back the exact content.',
      }[result.failReason] || null,
    });
  });

  router.get('/settings/danger', (req, res) => {
    return res.status(200).render('pages/admin/settings/danger', {
      title: 'Admin \u00b7 Settings \u00b7 Danger zone',
      bodyClass: 'admin',
      isAdmin: true,
      currentPage: 'settings',
      settingsTab: 'danger',
      done: req.query.done === '1',
      counts:
        req.query.done === '1'
          ? {
              orders: req.query.orders || '0',
              entitlements: req.query.entitlements || '0',
              cartItems: req.query.cartItems || '0',
              accountCredits: req.query.accountCredits || '0',
              accountCreditUsages: req.query.accountCreditUsages || '0',
              adminAuditLog: req.query.adminAuditLog || '0',
            }
          : null,
      error: req.query.error || null,
    });
  });

  router.post('/settings/danger/reset-test-data', express.urlencoded({ extended: false }), async (req, res, next) => {
    const pool = getPool();

    // Second gate, server-side: the typed "RESET" confirmation is
    // enforced in the browser (see danger.hbs), but a POST is a POST —
    // don't rely on client-side JS alone for something this
    // destructive. The form includes the typed value as a hidden field
    // set by that same JS right before submit.
    if (String(req.body?.confirmText || '').trim() !== 'RESET') {
      return res.redirect(
        '/admin/settings/danger?error=' + encodeURIComponent('Confirmation text did not match "RESET". Nothing was deleted.'),
      );
    }

    try {
      const testDataResetService = require('../../modules/admin/testDataReset.service.cjs');
      const { counts } = await testDataResetService.resetTestStatistics({
        pool,
        actorUserId: resolveActorUserId(req),
      });

      const qs = new URLSearchParams({
        done: '1',
        orders: String(counts.orders),
        entitlements: String(counts.entitlements),
        cartItems: String(counts.cartItems),
        accountCredits: String(counts.accountCredits),
        accountCreditUsages: String(counts.accountCreditUsages),
        adminAuditLog: String(counts.adminAuditLog),
      });
      return res.redirect('/admin/settings/danger?' + qs.toString());
    } catch (err) {
      return next(err);
    }
  });

  router.get('/security', (req, res) => {
    return res.status(200).render('pages/admin/security', {
      title: 'Admin \u00b7 Security',
      bodyClass: 'admin',
      isAdmin: true,
      currentPage: 'security',
    });
  });

  return router;
}

module.exports = { createAdminPagesRouter };
