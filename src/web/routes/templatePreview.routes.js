// src/web/routes/templatePreview.routes.js
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

import zipTool from '../../modules/templates/templateZip.contract.cjs';

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
