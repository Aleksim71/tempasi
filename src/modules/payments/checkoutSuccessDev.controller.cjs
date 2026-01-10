'use strict';

function toStr(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function escapeHtml(s) {
  return toStr(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function upper(v) {
  return toStr(v).trim().toUpperCase();
}

// Cache across requests (dev is single process)
let _cachedAllowedKinds = null;

async function loadAllowedKinds(client) {
  if (Array.isArray(_cachedAllowedKinds) && _cachedAllowedKinds.length) return _cachedAllowedKinds;

  // Try to read CHECK constraint definition
  const r = await client.query(
    `
    SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.conrelid = 'public.entitlements'::regclass
       AND c.contype = 'c'
       AND c.conname = 'entitlements_kind_check'
     LIMIT 1
    `
  );

  const def = r.rows[0]?.def ? String(r.rows[0].def) : '';

  // Typical forms:
  // CHECK ((kind = ANY (ARRAY['BUY'::text, 'RENT'::text])))
  // CHECK ((kind = ANY (ARRAY['purchase'::text])))
  // We'll extract all single-quoted tokens before ::text
  const tokens = [];
  const re = /'([^']+)'::text/g;
  let m;
  while ((m = re.exec(def))) tokens.push(m[1]);

  _cachedAllowedKinds = tokens.length ? tokens : [];
  return _cachedAllowedKinds;
}

function chooseKindFromAllowed(orderDealType, allowed) {
  const dt = upper(orderDealType);

  // Prefer exact match (BUY/RENT etc.)
  if (allowed.includes(dt)) return dt;

  // Common alternative schemas:
  // 'purchase', 'rent', 'buy', 'active', etc.
  const preferred = ['purchase', 'buy', 'rent', 'active'];
  for (const p of preferred) {
    if (allowed.includes(p)) return p;
    if (allowed.includes(p.toUpperCase())) return p.toUpperCase();
  }

  // Fallback to first allowed, else safe default (won't pass constraint though)
  return allowed[0] ?? dt ?? 'BUY';
}

async function handleCheckoutSuccessDev(req, res) {
  const sessionId = toStr(req.query.session_id).trim();
  const orderIdRaw = toStr(req.query.order_id).trim();
  const orderId = orderIdRaw ? Number(orderIdRaw) : NaN;

  if (!sessionId && !Number.isFinite(orderId)) {
    const err = new Error('CHECKOUT_SUCCESS_MISSING_PARAMS');
    err.status = 400;
    throw err;
  }

  const { pool } = require('../../config/db.cjs');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1) find order (by id preferred, else by provider_session_id)
    let order = null;

    if (Number.isFinite(orderId)) {
      const r = await client.query(`SELECT * FROM public.orders WHERE id = $1 LIMIT 1`, [orderId]);
      order = r.rows[0] || null;
    } else if (sessionId) {
      const r = await client.query(
        `SELECT * FROM public.orders WHERE provider_session_id = $1 LIMIT 1`,
        [sessionId]
      );
      order = r.rows[0] || null;
    }

    if (!order) {
      const err = new Error('ORDER_NOT_FOUND');
      err.status = 404;
      throw err;
    }

    // 2) mark order paid (idempotent)
    await client.query(
      `
      UPDATE public.orders
         SET status = 'paid',
             updated_at = now()
       WHERE id = $1
      `,
      [order.id]
    );

    // 3) upsert entitlement (KIND chosen from DB constraint)
    const allowedKinds = await loadAllowedKinds(client);
    const kind = chooseKindFromAllowed(order.deal_type, allowedKinds);

    await client.query(
      `
      INSERT INTO public.entitlements (user_id, template_slug, kind, order_id, starts_at, ends_at, created_at)
      VALUES ($1, $2, $3, $4, now(), NULL, now())
      ON CONFLICT (user_id, template_slug)
      DO UPDATE SET
        kind = EXCLUDED.kind,
        order_id = EXCLUDED.order_id,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at
      `,
      [order.user_id, order.template_slug, kind, order.id]
    );

    await client.query('COMMIT');

    // 4) success HTML + CTA
    const slug = encodeURIComponent(order.template_slug);
    const downloadUrl = `/download/${slug}`;

    res.type('html').send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Оплата успешна — Tempasi</title>
  <link rel="stylesheet" href="/css/core.css"/>
  <link rel="stylesheet" href="/css/custom.css"/>
</head>
<body>
  <main class="page">
    <h1>✅ Оплата успешна</h1>
    <p>Заказ #${escapeHtml(order.id)} — шаблон <b>${escapeHtml(order.template_slug)}</b> активирован.</p>
    <p><a class="btn primary" href="${downloadUrl}">Скачать ZIP</a></p>
    <p style="opacity:.7;font-size:12px">session_id: ${escapeHtml(sessionId || order.provider_session_id || '')}</p>
  </main>
</body>
</html>`);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { handleCheckoutSuccessDev };
