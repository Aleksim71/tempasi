// src/modules/downloads/downloads.controller.cjs
/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');

const { assertCanDownload } = require('./downloads.service.cjs');

/**
 * Resolve userId from auth/session.
 * Keep tolerant for dev-login + different auth shapes.
 */
function getUserId(req) {
  if (req && req.user && Number.isFinite(Number(req.user.id))) return Number(req.user.id);
  if (req && req.session && Number.isFinite(Number(req.session.userId))) return Number(req.session.userId);
  if (req && req.session && Number.isFinite(Number(req.session.user_id))) return Number(req.session.user_id);
  return null;
}

function downloadStubEnabled() {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.TEMPASI_ENABLE_DOWNLOAD_STUB === '1'
  );
}

async function resolveDownloadFile(db, templateSlug) {
  // TEMPASI_DOWNLOAD_USE_REAL_ZIP_PATH (2026-08-04)
  // This used to ONLY guess at storage/templates/<slug>/*.zip paths —
  // which only ever existed for templates manually run through the
  // (now-removed) ingest-template.js CLI script. The actual uploaded
  // ZIP for a real seller template lives wherever
  // seller_templates.zip_path says (TEMPLATE_UPLOAD_DIR, a flat,
  // randomly-named file — not under any storage/templates/<slug>/
  // folder), and this function never looked there at all. Real
  // purchased-template downloads were silently falling through to
  // the dev/test stub response instead of the actual file.
  if (db && typeof db.query === 'function') {
    try {
      const { rows } = await db.query(
        `SELECT zip_path FROM seller_templates WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
        [templateSlug],
      );
      const dbZipPath = rows[0]?.zip_path;
      if (dbZipPath) {
        const resolved = path.resolve(dbZipPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          return resolved;
        }
      }
    } catch (_e) {
      // fall through to legacy candidates below
    }
  }

  // Legacy fallback: templates manually placed via the old CLI
  // ingest pipeline (storage/templates/), if any still remain.
  // Common places in this repo:
  // - storage/templates/<slug>/template.zip
  // - storage/templates/<slug>/download.zip
  // - storage/templates/<slug>/<slug>.zip
  // - public/templates/<slug>.zip (less likely)
  const candidates = [
    path.resolve(process.cwd(), 'storage', 'templates', templateSlug, 'template.zip'),
    path.resolve(process.cwd(), 'storage', 'templates', templateSlug, 'download.zip'),
    path.resolve(process.cwd(), 'storage', 'templates', templateSlug, `${templateSlug}.zip`),
    path.resolve(process.cwd(), 'public', 'templates', `${templateSlug}.zip`),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_e) {
      // ignore
    }
  }
  return null;
}

/**
 * GET /downloads/:templateSlug
 * Requirements:
 * - must be logged in (tests send sid cookie)
 * - must have a valid entitlement for templateSlug
 *
 * NOTE (Stage 0.5):
 * Entitlement checks MUST be canonical and live in downloads.service (single source of truth).
 *
 * Behavior:
 * - If real zip exists -> send it.
 * - If zip is missing (common in test DB / minimal seed) -> return 200 stub
 *   so E2E can still validate entitlement gating without needing real files.
 */
async function downloadTemplate(req, res, next) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
    }

    const templateSlug = String(req.params.templateSlug || req.params.slug || '').trim();
    if (!templateSlug) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing templateSlug' } });
    }

    const db = req.db || req.app?.locals?.db || req.locals?.db || null;
    if (!db) {
      return res.status(500).json({ error: { code: 'DOWNLOAD_FAILED', message: 'DB not wired' } });
    }

    // Canonical gating (BUY vs RENT logic lives inside the service/repo)
    try {
      await assertCanDownload({ db, userId, templateSlug });
    } catch (_e) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No entitlement' } });
    }

    const filePath = await resolveDownloadFile(db, templateSlug);

    // Schema/test-friendly stub is allowed only outside production,
    // or when explicitly enabled for controlled diagnostics.
    if (!filePath) {
      if (downloadStubEnabled()) {
        return res.status(200).type('text').send(`DOWNLOAD OK (stub): ${templateSlug}`);
      }

      return res.status(404).json({
        error: { code: 'DOWNLOAD_FILE_NOT_FOUND', message: 'Download file not found' },
      });
    }

    // Real download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${templateSlug}.zip"`);
    return res.sendFile(filePath);
  } catch (err) {
    return next(err);
  }
}

// compat alias: routes expect downloadZip
const downloadZip = downloadTemplate;

module.exports = { downloadTemplate, downloadZip };
