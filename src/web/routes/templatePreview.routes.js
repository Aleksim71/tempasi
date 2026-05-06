// src/web/routes/templatePreview.routes.js
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import zipTool from '../../modules/templates/templateZip.contract.cjs';

const execFileAsync = promisify(execFile);

function toStr(v) {
  return v == null ? '' : String(v);
}

function requireDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new Error(
      'DB_NOT_CONFIGURED: req.app.locals.db must be a pg Pool-like object with .query()',
    );
  }
  return db;
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

function normalizeZipEntryName(value) {
  return toStr(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').trim();
}

function normalizeDemoAssetPath(value) {
  const clean = normalizeZipEntryName(value || 'index.html');

  if (!clean || clean === '.' || clean.endsWith('/')) return 'index.html';
  if (clean.includes('\0')) return '';
  if (clean.split('/').some((part) => part === '..' || part === '.')) return '';
  return clean;
}

function getContentTypeForDemoAsset(assetPath) {
  const ext = path.extname(assetPath).toLowerCase();

  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.ttf') return 'font/ttf';

  return 'application/octet-stream';
}

async function listZipEntries(zipPath) {
  const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath], {
    maxBuffer: 1024 * 1024 * 5,
  });

  return stdout
    .split(/\r?\n/)
    .map(normalizeZipEntryName)
    .filter(Boolean)
    .filter((entry) => !entry.endsWith('/'));
}

function findDemoEntry(entries, assetPath) {
  const requested = normalizeDemoAssetPath(assetPath);
  if (!requested) return '';

  const exact = entries.find((entry) => entry === requested);
  if (exact) return exact;

  const candidates = entries.filter((entry) => entry.endsWith(`/${requested}`));
  if (candidates.length === 1) return candidates[0];

  const indexCandidates = entries.filter((entry) => /(^|\/)index\.html$/i.test(entry));
  if (requested === 'index.html' && indexCandidates.length === 1) return indexCandidates[0];

  if (indexCandidates.length === 1) {
    const root = indexCandidates[0].slice(0, -'index.html'.length);
    const rooted = `${root}${requested}`;
    const rootedMatch = entries.find((entry) => entry === rooted);
    if (rootedMatch) return rootedMatch;
  }

  return '';
}

async function readZipEntry(zipPath, entryName) {
  const { stdout } = await execFileAsync('unzip', ['-p', zipPath, entryName], {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 25,
  });

  return stdout;
}

async function serveDemoAsset(req, res, next) {
  const sourcePath = toStr(req.originalUrl || req.url || req.path).split('?')[0];
  const match = sourcePath.match(/^\/t\/([^/]+)\/demo(?:\/(.*))?$/);

  if (!match) return next();

  const slug = toStr(match[1]).trim();
  if (!slug) return res.status(404).end();

  const rawAssetPath = toStr(match[2] || 'index.html');
  const assetPath = normalizeDemoAssetPath(rawAssetPath);
  if (!assetPath) return res.status(404).end();

  try {
    const db = requireDb(req.app.locals?.db);

    const q = `
      SELECT id, zip_path
      FROM seller_templates
      WHERE slug = $1
        AND status = 'published'
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const { rows } = await db.query(q, [slug]);
    const row = rows && rows[0] ? rows[0] : null;
    if (!row) return res.status(404).end();

    const zipPath = toStr(row.zip_path).trim();
    if (!zipPath) return res.status(404).end();

    // Demo serving intentionally does not run the full upload contract validator.
    // The ZIP path comes from DB, asset paths are normalized, and entries are read by exact ZIP name.
    const entries = await listZipEntries(zipPath);
    const entryName = findDemoEntry(entries, assetPath);
    if (!entryName) return res.status(404).end();

    const body = await readZipEntry(zipPath, entryName);
    res.setHeader('Content-Type', getContentTypeForDemoAsset(assetPath));
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(body);
  } catch (_err) {
    return res.status(404).end();
  }
}

/**
 * Public preview endpoint.
 *
 * URL: /t/:slug/preview.png
 * Storage: public/uploads/previews/<templateId>.png
 *
 * Behavior:
 * - if preview file exists -> send it
 * - else if zip exists -> extract preview.png from zip into the preview file and send it
 * - else -> 404
 *
 * Important: this route should never crash the whole app; if it fails, we return 404.
 */
export function createTemplatePreviewRouter() {
  const router = Router();

  router.use(serveDemoAsset);

  router.get('/:slug/preview.png', async (req, res) => {
    const slug = toStr(req.params.slug).trim();
    if (!slug) return res.status(404).end();

    try {
      const db = requireDb(req.app.locals?.db);

      const q = `
        SELECT id, zip_path
        FROM seller_templates
        WHERE slug = $1
          AND status = 'published'
          AND deleted_at IS NULL
        LIMIT 1
      `;
      const { rows } = await db.query(q, [slug]);
      const row = rows && rows[0] ? rows[0] : null;
      if (!row) return res.status(404).end();

      const templateId = row.id;
      const zipPath = toStr(row.zip_path).trim();

      const previewsDir = path.join(process.cwd(), 'public', 'uploads', 'previews');
      const outPath = path.join(previewsDir, `${templateId}.png`);

      // Serve existing file immediately
      const st = safeStat(outPath);
      if (st && st.isFile() && st.size > 0) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(outPath);
      }

      // Try to generate from zip if available
      if (zipPath) {
        await ensureDir(previewsDir);

        // Validate archive structure + preview presence
        zipTool.validateTemplateZipOrThrow(zipPath);

        // Extract preview png to deterministic location
        await zipTool.extractPreviewPngToFile({ zipPath, outPath });

        const st2 = safeStat(outPath);
        if (st2 && st2.isFile() && st2.size > 0) {
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.sendFile(outPath);
        }
      }

      return res.status(404).end();
    } catch (_err) {
      // Never crash app for preview endpoint
      return res.status(404).end();
    }
  });

  return router;
}

export default {
  createTemplatePreviewRouter,
};
