// src/modules/storage/templateStorageCheck.cjs
'use strict';

const fs = require('fs');
const path = require('path');

// TEMPASI_TEMPLATE_STORAGE_CHECK (2026-08-05)
// Pure, side-effect-free (besides the deliberate write/read/delete
// round-trip against the target directory itself) check of whether
// TEMPLATE_UPLOAD_DIR is currently reachable for uploading and
// reading templates. Shared by:
//   - scripts/check-template-storage.cjs (CLI wrapper: prints the
//     result and calls process.exit — never do that here, this
//     module is also require()'d directly from a live web request in
//     the admin Settings > Storage page, where a stray process.exit
//     would take the whole server down).
//   - src/web/routes/admin.pages.routes.cjs (GET /admin/settings/storage)
//
// Same technique the `mountpoint` Unix command uses: a mounted
// directory has a different device id (st_dev) than its parent. A
// plain local subdirectory shares the same device id as its parent.
function isMountPoint(dirPath) {
  const resolved = path.resolve(dirPath);
  const parent = path.dirname(resolved);
  const dirStat = fs.statSync(resolved);
  const parentStat = fs.statSync(parent);
  return dirStat.dev !== parentStat.dev;
}

function checkReadWrite(dir) {
  const marker = path.join(dir, `.tempasi-storage-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const content = `tempasi-storage-check ${new Date().toISOString()}`;

  fs.writeFileSync(marker, content, 'utf8');
  const readBack = fs.readFileSync(marker, 'utf8');
  fs.unlinkSync(marker);

  return readBack === content;
}

function listExistingTemplates(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const slugDir = path.join(dir, e.name);
      const hasDemo = fs.existsSync(path.join(slugDir, 'src', 'index.html'));
      const hasPreview = fs.existsSync(path.join(slugDir, 'preview', 'preview.png'));
      return { slug: e.name, hasDemo, hasPreview };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function resolveUploadDir() {
  const configured = process.env.TEMPLATE_UPLOAD_DIR || process.env.UPLOAD_DIR;
  if (configured) {
    return { dir: path.resolve(configured), configured: true };
  }
  return { dir: path.join(__dirname, '..', '..', '..', 'uploads', 'templates'), configured: false };
}

// Returns a plain result object, never throws, never exits, never
// logs. Callers decide how to present it (console output for the
// CLI script, an .hbs view for the admin page).
function checkTemplateStorage() {
  const { dir, configured } = resolveUploadDir();

  const result = {
    dir,
    configured,
    dirExists: false,
    isMounted: null, // null = not applicable (unconfigured/local fallback)
    readWriteOk: null,
    templates: [],
    ok: false,
    failReason: null,
  };

  result.dirExists = fs.existsSync(dir);
  if (!result.dirExists) {
    result.failReason = 'DIR_NOT_FOUND';
    return result;
  }

  try {
    result.isMounted = isMountPoint(dir);
  } catch (_e) {
    result.failReason = 'STAT_FAILED';
    return result;
  }

  if (configured && !result.isMounted) {
    result.failReason = 'NOT_A_MOUNT';
    return result;
  }

  try {
    result.readWriteOk = checkReadWrite(dir);
  } catch (_e) {
    result.failReason = 'READ_WRITE_FAILED';
    return result;
  }

  if (!result.readWriteOk) {
    result.failReason = 'READ_WRITE_MISMATCH';
    return result;
  }

  result.templates = listExistingTemplates(dir);
  result.ok = true;
  return result;
}

module.exports = { checkTemplateStorage, isMountPoint };
