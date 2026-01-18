// src/web/routes/buy.routes.js
import path from 'node:path';
import express from 'express';
import fs from 'node:fs/promises';

const ROOT_DIR = process.cwd();
const ZIPS_DIR = path.join(ROOT_DIR, 'storage', 'zips');

function safeSlug(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

async function isZipReady(slug) {
  try {
    const items = await fs.readdir(ZIPS_DIR);
    return items.some((f) => {
      if (!f.toLowerCase().endsWith('.zip')) return false;
      return f === `${slug}.zip` || f.startsWith(`${slug}_`) || f.startsWith(`${slug}-`);
    });
  } catch {
    return false;
  }
}

/**
 * Fake buy flow:
 * POST /:slug/buy
 * - if zip not ready -> redirect back to templates with ?buy=zip_not_ready
 * - if zip ready -> redirect to /checkout/success?slug=...&from=...&fake=1
 */
export function createBuyRoutes() {
  const router = express.Router();

  router.post('/:slug/buy', async (req, res) => {
    const slug = safeSlug(req.params.slug);
    const from = typeof req.query.from === 'string' ? req.query.from : '';

    if (!slug) return res.status(404).type('text/plain').send('Not found');

    const zipReady = await isZipReady(slug);
    if (!zipReady) {
      // мягко возвращаем в каталог (без 500/404)
      const back = from === 'templates' ? '/templates' : '/templates';
      return res.redirect(302, `${back}?buy=zip_not_ready&slug=${encodeURIComponent(slug)}`);
    }

    const qs = new URLSearchParams();
    qs.set('slug', slug);
    if (from) qs.set('from', from);
    qs.set('fake', '1');

    return res.redirect(302, `/checkout/success?${qs.toString()}`);
  });

  return router;
}
