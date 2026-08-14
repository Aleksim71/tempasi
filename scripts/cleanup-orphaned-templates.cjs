#!/usr/bin/env node
// scripts/cleanup-orphaned-templates.cjs
'use strict';

// TEMPASI_CLEANUP_ORPHANED_TEMPLATES (2026-08-14)
//
// Deletes template folders/zips on TEMPLATE_UPLOAD_DIR (старичок) and
// in the git-backed backup (Archiv-11/tempasi-templates-backup) that
// are NOT referenced by any currently-active row in seller_templates
// (deleted_at IS NULL). Per explicit instruction: anything still
// sitting in Trash (soft-deleted, not yet purged) is treated as
// garbage too and gets swept up here — this is a harder cut than the
// admin Trash flow itself.
//
// Safety net: before touching старичок at all, this script runs one
// more real backup-templates.sh sync first, so whatever is about to
// be deleted gets one last snapshot into the backup's git history —
// recoverable via `git log` / `git checkout <old-commit> -- <path>`
// even after this script deletes it from both places. If that sync
// fails, the script aborts before deleting anything.
//
// No separate dry-run/confirmation gate in this script (explicitly
// requested) — but it still refuses to run unless both directories
// are confirmed real, reachable, mounted filesystems (same class of
// protection as backup-templates.sh/backup-db.sh — a different thing
// than the confirmation step that was intentionally skipped here).
//
// Classification, per top-level entry in each directory:
//   - directory whose name matches an active slug           -> KEEP
//   - directory whose name does NOT match any active slug   -> DELETE (recursive)
//   - *.zip file whose basename matches an active zip_path   -> KEEP
//   - *.zip file whose basename does NOT match               -> DELETE
//   - .git/ and dotfiles                                     -> never touched
//   - anything else (unrecognized shape)                     -> left alone, logged
//
// Usage:
//   node scripts/cleanup-orphaned-templates.cjs
//   npm run cleanup:orphaned-templates

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { getPool } = require('./db.pool.cjs');
const { isMountPoint } = require('../src/modules/storage/templateStorageCheck.cjs');

const SOURCE_DIR = path.resolve(process.env.TEMPLATE_UPLOAD_DIR || '/mnt/tempasi/templates');
// TEMPASI_CLEANUP_MOUNT_CHECK_FIX (2026-08-14): the mount-safety check
// must run against the DRIVE's own mount point (e.g.
// /media/aleksim/Archiv-11), never against a plain subfolder inside
// it — a subfolder always shares its parent's device id (same
// filesystem), so checking the subfolder directly would always look
// like "not a real mount" even when the drive genuinely is mounted.
// Same split already used correctly in backup-templates.sh/backup-db.sh
// (DEST_MOUNT vs DEST_DIR) — this mirrors that.
const BACKUP_DRIVE_MOUNT = path.resolve(process.env.TEMPLATES_BACKUP_MOUNT || '/media/aleksim/Archiv-11');
const BACKUP_DIR = path.resolve(
  process.env.TEMPLATES_BACKUP_DEST || path.join(BACKUP_DRIVE_MOUNT, 'tempasi-templates-backup'),
);

function classifyEntries(dirRoot, keepSlugs, keepZipBasenames) {
  const entries = fs.readdirSync(dirRoot, { withFileTypes: true });

  const keep = [];
  const deleteDirs = [];
  const deleteFiles = [];
  const skippedUnknown = [];

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      if (keepSlugs.has(entry.name)) {
        keep.push(`${entry.name}/`);
      } else {
        deleteDirs.push(entry.name);
      }
    } else if (entry.isFile() && entry.name.endsWith('.zip')) {
      if (keepZipBasenames.has(entry.name)) {
        keep.push(entry.name);
      } else {
        deleteFiles.push(entry.name);
      }
    } else {
      skippedUnknown.push(entry.name);
    }
  }

  return { keep, deleteDirs, deleteFiles, skippedUnknown };
}

function deleteFromFilesystem(dirRoot, plan) {
  for (const name of plan.deleteDirs) {
    fs.rmSync(path.join(dirRoot, name), { recursive: true, force: true });
    console.log(`  removed dir:  ${name}/`);
  }
  for (const name of plan.deleteFiles) {
    fs.rmSync(path.join(dirRoot, name), { force: true });
    console.log(`  removed file: ${name}`);
  }
}

function deleteFromGitRepo(dirRoot, plan) {
  const targets = [...plan.deleteDirs, ...plan.deleteFiles];
  if (targets.length === 0) return false;

  for (const name of targets) {
    execSync(`git rm -r --quiet -- ${JSON.stringify(name)}`, { cwd: dirRoot, stdio: 'inherit' });
  }

  const summary = `cleanup: remove ${plan.deleteDirs.length} orphaned template dirs + ${plan.deleteFiles.length} orphaned zips (not referenced by any active DB row)`;
  execSync(`git commit --quiet -m ${JSON.stringify(summary)}`, { cwd: dirRoot, stdio: 'inherit' });
  console.log(`  committed: ${summary}`);
  return true;
}

function requireRealMount(dir, label) {
  if (!fs.existsSync(dir)) {
    console.error(`ABORT: ${label} does not exist: ${dir}`);
    process.exit(1);
  }
  let mounted;
  try {
    mounted = isMountPoint(dir);
  } catch (e) {
    console.error(`ABORT: could not stat ${label} (${dir}): ${e.message}`);
    process.exit(1);
  }
  if (!mounted) {
    console.error(
      `ABORT: ${label} (${dir}) does not look like a real mounted filesystem ` +
        `(same device id as its parent). Refusing to run against what might be ` +
        `a plain local directory. Is it actually mounted?`,
    );
    process.exit(1);
  }
}

async function main() {
  console.log('=== Tempasi orphaned template cleanup ===');
  console.log(`Source: ${SOURCE_DIR}`);
  console.log(`Backup: ${BACKUP_DIR}`);
  console.log('');

  requireRealMount(SOURCE_DIR, 'source (TEMPLATE_UPLOAD_DIR)');
  requireRealMount(BACKUP_DRIVE_MOUNT, 'backup drive (TEMPLATES_BACKUP_MOUNT)');

  if (!fs.existsSync(BACKUP_DIR)) {
    console.error(`ABORT: backup dir does not exist: ${BACKUP_DIR}`);
    process.exit(1);
  }

  console.log('Both directories confirmed as real mounted filesystems.');
  console.log('');

  // Safety net: sync старичок -> Archiv-11 one more time BEFORE
  // deleting anything, so whatever gets deleted below is guaranteed
  // to exist in the backup's git history first.
  console.log('Running one more backup-templates.sh sync before deleting anything...');
  try {
    execSync('bash scripts/backup-templates.sh', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('ABORT: pre-cleanup backup sync failed. Not deleting anything.');
    console.error(String(e.message || e));
    process.exit(1);
  }
  console.log('');

  const pool = getPool();
  const { rows } = await pool.query('SELECT slug, zip_path FROM seller_templates WHERE deleted_at IS NULL');

  const keepSlugs = new Set(rows.map((r) => r.slug));
  const keepZipBasenames = new Set(rows.filter((r) => r.zip_path).map((r) => path.basename(r.zip_path)));

  console.log(`Active (non-deleted) templates in DB: ${keepSlugs.size}`);
  console.log(`Referenced zip files: ${keepZipBasenames.size}`);
  console.log('');

  for (const [label, dirRoot, isGitRepo] of [
    ['source', SOURCE_DIR, false],
    ['backup', BACKUP_DIR, true],
  ]) {
    console.log(`--- ${label}: ${dirRoot} ---`);
    const plan = classifyEntries(dirRoot, keepSlugs, keepZipBasenames);

    console.log(`Keeping ${plan.keep.length} entries.`);
    if (plan.skippedUnknown.length) {
      console.log(`Skipping ${plan.skippedUnknown.length} unrecognized entries (left untouched):`);
      for (const name of plan.skippedUnknown) console.log(`  ? ${name}`);
    }

    console.log(`Deleting ${plan.deleteDirs.length} orphaned dirs, ${plan.deleteFiles.length} orphaned zips:`);

    if (isGitRepo) {
      const committed = deleteFromGitRepo(dirRoot, plan);
      if (!committed) console.log('  nothing to delete.');
    } else {
      if (plan.deleteDirs.length === 0 && plan.deleteFiles.length === 0) {
        console.log('  nothing to delete.');
      } else {
        deleteFromFilesystem(dirRoot, plan);
      }
    }
    console.log('');
  }

  await pool.end();
  console.log('=== Done ===');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
