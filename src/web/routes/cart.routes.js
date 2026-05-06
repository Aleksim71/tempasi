// src/web/routes/cart.routes.js
import express from 'express';

function getUserId(req) {
  const raw =
    req?.user?.id ??
    req?.user?.user_id ??
    req?.user?.userId ??
    req?.session?.userId ??
    req?.session?.user_id ??
    req?.userId ??
    null;

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safeNextPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('/')) return '';
  if (raw.startsWith('//')) return '';
  if (raw.includes('\\')) return '';
  if (raw.length > 512) return '';
  if (raw.toLowerCase().includes('http://')) return '';
  if (raw.toLowerCase().includes('https://')) return '';
  return raw;
}

function normalizeRentDays(input) {
  const n = Number.parseInt(String(input || '1'), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 30);
}

function collectCaseIds(body = {}) {
  const raw = [];
  for (const key of ['case_ids', 'caseIds', 'caseId', 'case_id']) {
    const value = body[key];
    if (Array.isArray(value)) raw.push(...value);
    else if (value !== undefined && value !== null) raw.push(value);
  }

  const out = [];
  for (const value of raw) {
    const text = String(value || '').trim();
    if (!text) continue;
    if (text.includes(',')) {
      out.push(
        ...text
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      );
      continue;
    }
    out.push(text);
  }

  return [...new Set(out.map((id) => String(id || '').trim()).filter(Boolean))];
}

async function hasColumn(db, tableName, columnName) {
  const result = await db.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName],
  );
  return Boolean(result.rows?.[0]);
}

async function listOwnedCaseIds(db, userId, caseIds) {
  if (!caseIds.length) return [];
  const result = await db.query(
    `
      SELECT id
      FROM cases
      WHERE user_id = $1
        AND id = ANY($2::text[])
    `,
    [String(userId), caseIds.map(String)],
  );
  return (result.rows || []).map((row) => String(row.id));
}

function formatRentDurationLabel(license) {
  const match = String(license || '').match(/^PU:(\d+)d$/i);
  const days = match ? Number.parseInt(match[1], 10) : 1;
  const safeDays = Number.isFinite(days) && days > 0 ? days : 1;
  return `${safeDays} ${safeDays === 1 ? 'day' : 'days'} reservation`;
}

function redirectToLogin(res, nextPath) {
  const qs = new URLSearchParams();
  const safeNext = safeNextPath(nextPath);
  if (safeNext) qs.set('next', safeNext);
  return res.redirect(302, `/login?${qs.toString()}`);
}

function formatMoneyEurFromCents(cents) {
  const n = Number(cents || 0);
  if (!Number.isFinite(n)) return '0.00';
  return (n / 100).toFixed(2);
}

function formatDateYMD(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function pickNotice(req) {
  if (String(req.query?.added || '').trim()) {
    return 'Item added to cart.';
  }
  if (String(req.query?.exists || '').trim() === '1') {
    return 'Item is already in cart.';
  }
  if (String(req.query?.removed || '').trim() === '1') {
    return 'Item removed from cart.';
  }
  return '';
}

async function loadCartItems(db, userId) {
  const { rows } = await db.query(
    `
      SELECT
        ci.id,
        ci.template_slug,
        ci.deal_type,
        ci.license,
        ci.created_at,
        COALESCE(st.title, ci.template_slug) AS template_title,
        st.price_buy_cents,
        st.price_rent_cents
      FROM cart_items ci
      LEFT JOIN seller_templates st
        ON st.slug = ci.template_slug
      WHERE ci.user_id = $1
      ORDER BY ci.created_at DESC, ci.id DESC
    `,
    [userId],
  );

  return (rows || []).map((row) => {
    const dealType = String(row.deal_type || 'BUY').toUpperCase();
    const amountCents =
      dealType === 'RENT'
        ? Number(row.price_rent_cents || 0) *
          (Number.parseInt(String(row.license || '').match(/^PU:(\d+)d$/i)?.[1] || '1', 10) || 1)
        : Number(row.price_buy_cents || 0);

    return {
      id: row.id,
      template_slug: row.template_slug || '',
      template_title: row.template_title || row.template_slug || '',
      deal_type: dealType,
      license: row.license || 'PU',
      created_at_str: formatDateYMD(row.created_at),
      amountCents,
      amountEur: formatMoneyEurFromCents(amountCents),
      durationLabel: dealType === 'RENT' ? formatRentDurationLabel(row.license) : '',
      detailsHref: `/templates/${encodeURIComponent(row.template_slug || '')}`,
    };
  });
}

export function createCartRouter() {
  const router = express.Router();

  router.use(express.urlencoded({ extended: false }));

  router.get('/', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return redirectToLogin(res, '/cart');

      const db = req.app.locals?.db;
      if (!db || typeof db.query !== 'function') {
        throw new Error('DB_NOT_CONFIGURED');
      }

      const items = await loadCartItems(db, userId);
      const subtotalCents = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);

      return res.status(200).render('pages/cart', {
        title: 'Cart',
        styles: ['/css/pages/cart.css'],
        bodyClass: 'cart',
        hideHeader: false,
        hideFooter: false,
        cart: {
          items,
          itemCount: items.length,
          subtotalEur: formatMoneyEurFromCents(subtotalCents),
        },
        notice: pickNotice(req),
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/add', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const templateSlug = String(req.body?.template_slug || '').trim();
      const dealType = String(req.body?.deal_type || 'BUY')
        .trim()
        .toUpperCase();
      const rawLicense = String(req.body?.license || 'PU')
        .trim()
        .toUpperCase();
      const rentDays = dealType === 'RENT' ? normalizeRentDays(req.body?.rent_days) : null;
      const license = dealType === 'RENT' && rentDays ? `PU:${rentDays}d` : rawLicense;
      const licenseForValidation = rawLicense;
      const nextPath = safeNextPath(req.body?.next || `/templates/${templateSlug}`) || '/templates';
      const caseIds = dealType === 'RENT' ? collectCaseIds(req.body || {}) : [];

      if (!userId) return redirectToLogin(res, nextPath);
      if (!templateSlug) return res.redirect(302, '/templates');
      if (!['BUY', 'RENT'].includes(dealType)) {
        return res.redirect(302, `${nextPath}?cart=unsupported`);
      }
      if (!['PU', 'CU', 'EL', 'ML', 'EX'].includes(licenseForValidation)) {
        return res.redirect(302, `${nextPath}?cart=bad_license`);
      }

      if (dealType === 'RENT' && !rentDays) {
        return res.redirect(302, `${nextPath}?cart=rent_days_required`);
      }

      if (dealType === 'RENT' && caseIds.length === 0) {
        return res.redirect(302, `${nextPath}?cart=case_required`);
      }

      const db = req.app.locals?.db;
      if (!db || typeof db.query !== 'function') {
        throw new Error('DB_NOT_CONFIGURED');
      }

      const templateResult = await db.query(
        `
          SELECT slug, owner_user_id, price_buy_cents, price_rent_cents
          FROM seller_templates
          WHERE slug = $1
            AND status = 'published'
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [templateSlug],
      );

      const tpl = templateResult.rows?.[0] || null;
      if (!tpl) return res.redirect(302, '/templates');

      if (Number(tpl.owner_user_id) === Number(userId)) {
        return res.redirect(302, `${nextPath}?cart=owner_template`);
      }

      const buyPriceCents = Number(tpl.price_buy_cents || 0);
      const rentPriceCents = Number(tpl.price_rent_cents || 0);

      if (dealType === 'BUY' && (!Number.isFinite(buyPriceCents) || buyPriceCents <= 0)) {
        return res.redirect(302, `${nextPath}?cart=not_buyable`);
      }

      if (dealType === 'RENT' && (!Number.isFinite(rentPriceCents) || rentPriceCents <= 0)) {
        return res.redirect(302, `${nextPath}?cart=not_rentable`);
      }

      const soldResult = await db.query(
        `
          SELECT 1
          FROM orders
          WHERE template_slug = $1
            AND deal_type = 'BUY'
            AND status = 'paid'
          LIMIT 1
        `,
        [templateSlug],
      );
      if (soldResult.rows?.[0]) {
        return res.redirect(302, `${nextPath}?cart=sold`);
      }

      const activeRentResult = await db.query(
        `
          SELECT 1
          FROM entitlements
          WHERE template_slug = $1
            AND UPPER(COALESCE(deal_type, kind, '')) = 'RENT'
            AND closed_at IS NULL
            AND (ends_at IS NULL OR ends_at > NOW())
            AND user_id <> $2
          LIMIT 1
        `,
        [templateSlug, userId],
      );
      if (activeRentResult.rows?.[0]) {
        return res.redirect(302, `${nextPath}?cart=reserved`);
      }

      if (dealType === 'RENT' && caseIds.length > 0) {
        const ownedCaseIds = await listOwnedCaseIds(db, userId, caseIds);
        const ownedSet = new Set(ownedCaseIds.map(String));
        const missing = caseIds.filter((id) => !ownedSet.has(String(id)));
        if (missing.length > 0) {
          return res.redirect(302, `${nextPath}?cart=case_not_owned`);
        }
      }

      const ownedResult = await db.query(
        `
          SELECT 1
          FROM entitlements
          WHERE user_id = $1
            AND template_slug = $2
            AND UPPER(COALESCE(deal_type, 'BUY')) = 'BUY'
          LIMIT 1
        `,
        [userId, templateSlug],
      );
      if (ownedResult.rows?.[0]) {
        return res.redirect(302, `${nextPath}?cart=owned`);
      }

      if (dealType === 'BUY') {
        await db.query(
          `
            DELETE FROM cart_items
            WHERE user_id = $1
              AND template_slug = $2
              AND UPPER(deal_type) = 'RENT'
          `,
          [userId, templateSlug],
        );
      }

      if (dealType === 'RENT') {
        const buyCartResult = await db.query(
          `
            SELECT 1
            FROM cart_items
            WHERE user_id = $1
              AND template_slug = $2
              AND UPPER(deal_type) = 'BUY'
            LIMIT 1
          `,
          [userId, templateSlug],
        );

        if (buyCartResult.rows?.[0]) {
          return res.redirect(302, `${nextPath}?cart=buy_already_in_cart`);
        }
      }

      const cartHasCaseIds = await hasColumn(db, 'cart_items', 'case_ids');
      let insertResult;

      if (cartHasCaseIds) {
        insertResult = await db.query(
          `
            INSERT INTO cart_items (user_id, template_slug, deal_type, license, case_ids, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (user_id, template_slug, deal_type, license) DO UPDATE
              SET case_ids = EXCLUDED.case_ids,
                  updated_at = NOW()
            RETURNING id
          `,
          [
            userId,
            templateSlug,
            dealType,
            license,
            dealType === 'RENT' && caseIds.length ? JSON.stringify(caseIds) : null,
          ],
        );
      } else {
        // Backward-compatible fallback before the migration is applied.
        insertResult = await db.query(
          `
            INSERT INTO cart_items (user_id, template_slug, deal_type, license, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (user_id, template_slug, deal_type, license) DO NOTHING
            RETURNING id
          `,
          [userId, templateSlug, dealType, license],
        );
      }

      if (!insertResult.rows?.[0]) {
        return res.redirect(302, '/cart?exists=1');
      }

      return res.redirect(302, `/cart?added=${encodeURIComponent(templateSlug)}`);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/remove', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return redirectToLogin(res, '/cart');

      const itemId = Number(req.body?.item_id);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.redirect(302, '/cart');
      }

      const db = req.app.locals?.db;
      if (!db || typeof db.query !== 'function') {
        throw new Error('DB_NOT_CONFIGURED');
      }

      await db.query(
        `
          DELETE FROM cart_items
          WHERE id = $1
            AND user_id = $2
        `,
        [itemId, userId],
      );

      return res.redirect(302, '/cart?removed=1');
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default { createCartRouter };
