// src/web/routes/community.pages.routes.cjs
// Community directory (/community/*). Follows the admin/cabinet pages
// router convention: no-arg factory, own pool via scripts/db.pool.cjs.
// Mounted with requireAuthWeb in app.js — visible to registered users
// only. Only shows members who opted in via user_profiles.public_profile
// (toggle lives in Cabinet > Profile & Security > Basic Information).
'use strict';

const express = require('express');

const { getPool } = require('../../../scripts/db.pool.cjs');

const COMMUNITY_PAGE_SIZE = 24;

function formatEurOrDash(cents) {
  if (cents === null || cents === undefined) return null;
  return (Number(cents) / 100).toFixed(2);
}

function parsePage(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function createCommunityPagesRouter() {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    const pool = getPool();
    try {
      const page = parsePage(req.query.page);

      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM user_profiles WHERE public_profile = true`,
      );
      const total = countRes.rows[0]?.n || 0;
      const totalPages = Math.max(1, Math.ceil(total / COMMUNITY_PAGE_SIZE));
      const limit = COMMUNITY_PAGE_SIZE;
      const offset = (page - 1) * limit;

      const { rows } = await pool.query(
        `
        SELECT
          u.id,
          COALESCE(NULLIF(TRIM(up.nickname), ''), NULLIF(TRIM(up.full_name), ''), u.email) AS display_name,
          up.avatar_url,
          up.about,
          (
            SELECT COUNT(*) FROM seller_templates st
            WHERE st.owner_user_id = u.id AND st.status = 'published' AND st.deleted_at IS NULL
              AND st.price_buy_cents IS NOT NULL
          )::int AS buy_count,
          (
            SELECT COUNT(*) FROM seller_templates st
            WHERE st.owner_user_id = u.id AND st.status = 'published' AND st.deleted_at IS NULL
              AND st.price_rent_cents IS NOT NULL
          )::int AS rent_count
        FROM users u
        JOIN user_profiles up ON up.user_id = u.id
        WHERE up.public_profile = true
        ORDER BY up.updated_at DESC, u.id DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset],
      );

      const members = rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url || null,
        about: r.about || '',
        buyCount: r.buy_count,
        rentCount: r.rent_count,
      }));

      return res.status(200).render('pages/community/index', {
        title: 'Community \u2014 Tempasi',
        bodyClass: 'community-page',
        activePage: 'community',
        styles: ['/css/pages/community.css'],
        members,
        total,
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevHref: `/community?page=${Math.max(1, page - 1)}`,
        nextHref: `/community?page=${Math.min(totalPages, page + 1)}`,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:userId', async (req, res, next) => {
    const pool = getPool();
    const userId = Number(req.params.userId);

    if (!Number.isFinite(userId)) {
      return res.status(404).render('pages/errors/404');
    }

    try {
      const { rows } = await pool.query(
        `
        SELECT
          u.id,
          up.full_name,
          up.nickname,
          up.about,
          up.avatar_url,
          up.public_email,
          up.website_url,
          up.role_title,
          up.location
        FROM users u
        JOIN user_profiles up ON up.user_id = u.id
        WHERE u.id = $1 AND up.public_profile = true
        LIMIT 1
        `,
        [userId],
      );

      const profileRow = rows[0];
      if (!profileRow) {
        return res.status(404).render('pages/errors/404');
      }

      const templatesRes = await pool.query(
        `
        SELECT slug, title, preview_image, preview_url, price_buy_cents, price_rent_cents
        FROM seller_templates
        WHERE owner_user_id = $1 AND status = 'published' AND deleted_at IS NULL
        ORDER BY created_at DESC
        `,
        [userId],
      );

      const templates = templatesRes.rows.map((t) => ({
        slug: t.slug,
        title: t.title,
        previewSrc: t.preview_image || t.preview_url || null,
        priceBuyLabel: formatEurOrDash(t.price_buy_cents),
        priceRentLabel: formatEurOrDash(t.price_rent_cents),
      }));

      const displayName = profileRow.nickname || profileRow.full_name || 'Tempasi member';

      return res.status(200).render('pages/community/user', {
        title: `${displayName} \u2014 Tempasi Community`,
        bodyClass: 'community-page',
        activePage: 'community',
        styles: ['/css/pages/community.css'],
        member: {
          displayName,
          fullName: profileRow.full_name || '',
          nickname: profileRow.nickname || '',
          about: profileRow.about || '',
          avatarUrl: profileRow.avatar_url || null,
          publicEmail: profileRow.public_email || '',
          websiteUrl: profileRow.website_url || '',
          roleTitle: profileRow.role_title || '',
          location: profileRow.location || '',
        },
        templates,
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createCommunityPagesRouter };
