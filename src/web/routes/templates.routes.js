// src/web/routes/templates.routes.js
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function titleFromSlug(slug) {
  return String(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

async function exists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(p) {
  try {
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Detect templates root folder.
 *
 * Priority:
 *  1) ENV: TEMPLATES_ROOT
 *  2) <repoRoot>/storage/templates
 *  3) <repoRoot>/templates
 *  4) <repoRoot>/t
 */
async function detectTemplatesRoot() {
  const repoRoot = path.resolve(__dirname, '../../..'); // src/web/routes -> repo root

  const candidates = [];
  const env = process.env.TEMPLATES_ROOT;

  if (env && String(env).trim()) {
    const p = path.isAbsolute(env) ? env : path.resolve(repoRoot, env);
    candidates.push(p);
  }

  candidates.push(path.resolve(repoRoot, 'storage/templates'));
  candidates.push(path.resolve(repoRoot, 'templates'));
  candidates.push(path.resolve(repoRoot, 't'));

  for (const c of candidates) {
    try {
      const st = await fsp.stat(c);
      if (st.isDirectory()) return c;
    } catch {
      // ignore
    }
  }

  // fallback
  return path.resolve(repoRoot, 'storage/templates');
}

async function listSlugs(rootAbs) {
  let entries;
  try {
    entries = await fsp.readdir(rootAbs, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name && !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b));
}

async function hasPreview(templateDir) {
  // Generated previews live here:
  // storage/templates/<slug>/preview/preview.png
  const p = path.join(templateDir, 'preview', 'preview.png');
  return exists(p);
}

async function hasZip(templateDir, slug) {
  const candidates = [
    path.join(templateDir, 'dist', `${slug}.zip`),
    path.join(templateDir, 'dist', 'template.zip'),
    path.join(templateDir, `${slug}.zip`),
    path.join(templateDir, 'template.zip'),
  ];

  for (const c of candidates) {
     
    if (await exists(c)) return true;
  }
  return false;
}

async function loadTemplatesList() {
  const rootAbs = await detectTemplatesRoot();
  const slugs = await listSlugs(rootAbs);

  const templates = [];

  for (const slug of slugs) {
    const templateDir = path.join(rootAbs, slug);

    // Optional metadata files (any one)
     
    const meta =
      (await readJsonIfExists(path.join(templateDir, 'template.json'))) ||
      (await readJsonIfExists(path.join(templateDir, 'meta.json'))) ||
      (await readJsonIfExists(path.join(templateDir, 'tempasi.template.json'))) ||
      null;

    const title =
      meta && (meta.title || meta.name) ? String(meta.title || meta.name) : titleFromSlug(slug);

    const license = meta && meta.license ? String(meta.license) : '';

     
    const previewReady =
      meta && typeof meta.previewReady === 'boolean'
        ? meta.previewReady
        : await hasPreview(templateDir);

     
    const zipReady =
      meta && typeof meta.zipReady === 'boolean' ? meta.zipReady : await hasZip(templateDir, slug);

    templates.push({
      slug,
      title,
      license,
      previewReady,
      zipReady,

      // URLs used by SSR template
      previewImgUrl: `/t/${slug}/preview/preview.png`,
      previewHref: `/preview/${slug}`,
      buyHref: `/${slug}/buy`,
      downloadHref: `/download/${slug}`,
    });
  }

  return { rootAbs, templates };
}

export function createTemplatesRouter() {
  const router = express.Router();

  router.get('/templates', async (req, res, next) => {
    try {
      const { rootAbs, templates } = await loadTemplatesList();

      // Debug header
      res.set('X-Tempasi-Templates-Root', rootAbs);

      return res.render('pages/templates/index', {
        layout: 'main',
        title: 'Templates',
        pageCss: '/css/pages/catalog.css',
        templates,
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
