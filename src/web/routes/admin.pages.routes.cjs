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

  // Stubs for Part 2: nav is live, content lands page by page.
  router.get('/templates', (req, res) => {
    return res.status(200).render('pages/admin/templates', {
      title: 'Admin \u00b7 Templates',
      bodyClass: 'admin',
      isAdmin: true,
      currentPage: 'templates',
    });
  });

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
