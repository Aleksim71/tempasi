// src/app.web.js
import path from 'node:path';
import express from 'express';
import { create } from 'express-handlebars';
import fs from 'node:fs/promises';

import { createDownloadRoutes } from './web/routes/download.routes.js';
import { createBuyRoutes } from './web/routes/buy.routes.js';

const ROOT_DIR = process.cwd();

const VIEWS_DIR = path.join(ROOT_DIR, 'src', 'web', 'views');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const TEMPLATES_DIR = path.join(ROOT_DIR, 'storage', 'templates');
const ZIPS_DIR = path.join(ROOT_DIR, 'storage', 'zips');

function safeSlug(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

function normalizeTemplate(slug, meta, hasPreview, zipReady) {
  const title = meta?.title || meta?.name || meta?.displayName || meta?.slug || `Seed ${slug}`;

  const version = meta?.version ? String(meta.version) : '';

  const licenses = Array.isArray(meta?.licenses)
    ? meta.licenses
    : Array.isArray(meta?.license)
      ? meta.license
      : [];

  const previewPngUrl = `/t/${slug}/preview/preview.png`;
  const previewLink = `/preview/${slug}`;
  const downloadLink = `/download/${slug}`;

  return {
    slug,
    id: slug,

    title,
    name: title,
    version,

    hasPreview,
    has_preview: hasPreview,

    zipReady,
    zip_ready: zipReady,

    preview: previewPngUrl,
    previewUrl: previewPngUrl,

    previewLink,
    downloadLink,

    licenses,
    license: licenses,
  };
}

export async function createWebApp(app) {
  // ---- handlebars
  const hbs = create({
    extname: '.hbs',
    layoutsDir: path.join(VIEWS_DIR, 'layouts'),
    partialsDir: path.join(VIEWS_DIR, 'partials'),
    defaultLayout: 'main',
    helpers: {
      eq: (a, b) => a === b,
    },
  });

  app.engine('.hbs', hbs.engine);
  app.set('view engine', '.hbs');
  app.set('views', VIEWS_DIR);

  // ---- static
  app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));
  app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), { maxAge: 0 }));
  app.use('/icons', express.static(path.join(PUBLIC_DIR, 'icons'), { maxAge: 0 }));

  // templates mount
  app.use('/t', express.static(TEMPLATES_DIR, { maxAge: 0 }));

  // ---- feature routes (download + buy)
  app.use(createDownloadRoutes());
  app.use(createBuyRoutes());

  // ---- routes
  app.get('/', (req, res) => res.redirect(302, '/templates'));

  app.get('/templates', async (req, res, next) => {
    try {
      const dirents = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
      const slugs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);

      const templates = [];
      for (const raw of slugs) {
        const slug = safeSlug(raw);
        if (!slug) continue;

        const previewAbs = path.join(TEMPLATES_DIR, slug, 'preview', 'preview.png');
        const metaAbs = path.join(TEMPLATES_DIR, slug, 'metadata.json');

        const hasPreview = await fileExists(previewAbs);
        const zipReady = await isZipReady(slug);
        const meta = await readJsonIfExists(metaAbs);

        templates.push(normalizeTemplate(slug, meta, hasPreview, zipReady));
      }

      return res.render('pages/templates/index', { templates });
    } catch (e) {
      return next(e);
    }
  });

  app.get('/preview/:slug', (req, res) => {
    const slug = safeSlug(req.params.slug);
    if (!slug) return res.status(404).type('text/plain').send('Not found');
    return res.redirect(302, `/t/${slug}/src/index.html`);
  });

  // Fake checkout success page
  app.get('/checkout/success', async (req, res) => {
    const slug = safeSlug(req.query.slug);
    if (!slug) return res.status(404).type('text/plain').send('Not found');

    const zipReady = await isZipReady(slug);
    return res.render('pages/checkout-success', {
      slug,
      zip_ready: zipReady,
    });
  });
}
