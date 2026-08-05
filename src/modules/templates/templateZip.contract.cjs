/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isPngSignature(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function runUnzipList(zipPath) {
  return new Promise((resolve, reject) => {
    if (!zipPath) return reject(new Error('ZIP_PATH_REQUIRED'));
    if (!fileExists(zipPath)) {
      const err = new Error('ZIP_NOT_FOUND');
      err.code = 'ZIP_NOT_FOUND';
      err.details = { zipPath };
      return reject(err);
    }

    // zip entry listing, one per line
    const child = spawn('unzip', ['-Z1', zipPath], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    let errOut = '';

    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (errOut += d.toString('utf8')));

    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) {
        const err = new Error(`UNZIP_LIST_FAILED`);
        err.code = 'UNZIP_LIST_FAILED';
        err.details = { zipPath, stderr: errOut };
        return reject(err);
      }

      const lines = out
        .split('\n')
        .map((s) => String(s || '').trim()) // IMPORTANT: trim to remove accidental leading spaces
        .filter(Boolean);

      resolve(lines);
    });
  });
}

function pickPreviewEntry(entries) {
  // Accept:
  // - preview/preview.png
  // - preview.png
  // - <root>/preview/preview.png
  // - <root>/preview.png
  const candidates = entries.filter((e) => {
    const p = e.replace(/\\/g, '/');
    return (
      /(^|\/)preview\/preview\.png$/i.test(p) ||
      /(^|\/)preview\.png$/i.test(p)
    );
  });

  // Prefer preview/preview.png if present
  const preferred =
    candidates.find((e) => /(^|\/)preview\/preview\.png$/i.test(e.replace(/\\/g, '/'))) ||
    candidates[0] ||
    null;

  return preferred;
}

function pickIndexEntry(entries) {
  // Accept:
  // - index.html
  // - src/index.html
  // - <root>/index.html
  // - <root>/src/index.html
  const candidates = entries.filter((e) => {
    const p = e.replace(/\\/g, '/');
    return /(^|\/)index\.html$/i.test(p) || /(^|\/)src\/index\.html$/i.test(p);
  });

  // Prefer src/index.html if present
  const preferred =
    candidates.find((e) => /(^|\/)src\/index\.html$/i.test(e.replace(/\\/g, '/'))) ||
    candidates.find((e) => /(^|\/)index\.html$/i.test(e.replace(/\\/g, '/'))) ||
    candidates[0] ||
    null;

  return preferred;
}

function validateTemplateZipOrThrow(zipPath) {
  // sync-looking API but internally relies on unzip listing async -> this wrapper is async-like elsewhere
  // Keeping it as a function that returns a promise is more honest; but we already used it in code as sync.
  // We'll keep this variant: returns object, but it MUST be called with await via validateTemplateZipOrThrowAsync.
  throw new Error('USE_validateTemplateZipOrThrowAsync');
}

async function validateTemplateZipOrThrowAsync(zipPath) {
  const entries = await runUnzipList(zipPath);

  const previewEntry = pickPreviewEntry(entries);
  if (!previewEntry) {
    const err = new Error('PREVIEW_MISSING');
    err.code = 'PREVIEW_MISSING';
    err.details = { hint: 'ZIP must contain preview/preview.png or preview.png' };
    throw err;
  }

  const indexEntry = pickIndexEntry(entries);
  if (!indexEntry) {
    const err = new Error('INDEX_MISSING');
    err.code = 'INDEX_MISSING';
    err.details = { hint: 'ZIP must contain index.html or src/index.html' };
    throw err;
  }

  return {
    ok: true,
    previewEntry,
    indexEntry,
  };
}

function extractZipEntryToBuffer({ zipPath, entry }) {
  return new Promise((resolve, reject) => {
    if (!zipPath) return reject(new Error('ZIP_PATH_REQUIRED'));
    if (!entry) return reject(new Error('ZIP_ENTRY_REQUIRED'));
    if (!fileExists(zipPath)) {
      const err = new Error('ZIP_NOT_FOUND');
      err.code = 'ZIP_NOT_FOUND';
      err.details = { zipPath };
      return reject(err);
    }

    // IMPORTANT: use unzip -p (stdout is binary file contents), keep stderr separate
    const child = spawn('unzip', ['-p', zipPath, entry], { stdio: ['ignore', 'pipe', 'pipe'] });

    const chunks = [];
    let errOut = '';

    child.stdout.on('data', (d) => chunks.push(Buffer.from(d)));
    child.stderr.on('data', (d) => (errOut += d.toString('utf8')));

    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) {
        const err = new Error('UNZIP_EXTRACT_FAILED');
        err.code = 'UNZIP_EXTRACT_FAILED';
        err.details = { zipPath, entry, stderr: errOut };
        return reject(err);
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function extractPreviewPngToFile({ zipPath, outPath }) {
  const v = await validateTemplateZipOrThrowAsync(zipPath);
  const entryUsed = v.previewEntry;

  const buf = await extractZipEntryToBuffer({ zipPath, entry: entryUsed });

  if (!isPngSignature(buf)) {
    const err = new Error('PREVIEW_NOT_PNG');
    err.code = 'PREVIEW_NOT_PNG';
    err.details = { entryUsed };
    throw err;
  }

  ensureDirSync(path.dirname(outPath));
  fs.writeFileSync(outPath, buf);

  return { outPath, entryUsed };
}

// ------------------------------------------------------------
// TEMPASI_FULL_EXTRACT_TO_UPLOAD_DIR (2026-08-04)
// Ported from the old ingest-template.js CLI script (now removed —
// this used to be a manual "designer sends a ZIP, admin runs this by
// hand" step; now it runs automatically as part of the seller's own
// upload). Same unpack/normalize/validate rules as that script:
//   - unzip into a temp dir
//   - detect and unwrap a single top-level "<slug>/" wrapper folder
//     if the ZIP has one (some ZIP tools add this automatically)
//   - require src/index.html to exist
//   - reject node_modules, symlinks, path traversal, files >10 MiB
//   - copy the validated payload into destRoot/<slug>/
// ------------------------------------------------------------

const MAX_FULL_EXTRACT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

function runFullUnzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-qq', zipPath, '-d', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errOut = '';
    child.stderr.on('data', (d) => (errOut += d.toString('utf8')));
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) {
        const err = new Error('UNZIP_EXTRACT_ALL_FAILED');
        err.code = 'UNZIP_EXTRACT_ALL_FAILED';
        err.details = { zipPath, stderr: errOut };
        return reject(err);
      }
      resolve();
    });
  });
}

function detectPayloadRoot(stagingDir) {
  const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    // ZIP had a single top-level "<slug>/" wrapper folder — unwrap it.
    return path.join(stagingDir, entries[0].name);
  }
  return stagingDir;
}

function validateExtractedTree(rootDir) {
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const rel = path.relative(rootDir, current) || '.';
    const name = path.basename(current);

    if (name === 'node_modules') {
      const err = new Error('FORBIDDEN_FOLDER');
      err.code = 'FORBIDDEN_FOLDER';
      err.details = { rel };
      throw err;
    }

    const stat = fs.lstatSync(current);

    if (stat.isSymbolicLink()) {
      const err = new Error('SYMLINK_NOT_ALLOWED');
      err.code = 'SYMLINK_NOT_ALLOWED';
      err.details = { rel };
      throw err;
    }

    if (stat.isDirectory()) {
      const children = fs.readdirSync(current);
      for (const child of children) {
        const childPath = path.join(current, child);
        const relChild = path.relative(rootDir, childPath);
        if (relChild.split(path.sep).includes('..')) {
          const err = new Error('PATH_TRAVERSAL');
          err.code = 'PATH_TRAVERSAL';
          err.details = { relChild };
          throw err;
        }
        stack.push(childPath);
      }
      continue;
    }

    if (stat.isFile() && stat.size > MAX_FULL_EXTRACT_FILE_SIZE_BYTES) {
      const err = new Error('FILE_TOO_LARGE');
      err.code = 'FILE_TOO_LARGE';
      err.details = { rel, size: stat.size, max: MAX_FULL_EXTRACT_FILE_SIZE_BYTES };
      throw err;
    }
  }
}

async function extractFullTemplateToUploadDir({ zipPath, slug, destRoot }) {
  if (!zipPath) throw new Error('ZIP_PATH_REQUIRED');
  if (!slug) throw new Error('SLUG_REQUIRED');
  if (!destRoot) throw new Error('DEST_ROOT_REQUIRED');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tempasi-upload-extract-'));

  try {
    await runFullUnzip(zipPath, tmpRoot);
    const payloadRoot = detectPayloadRoot(tmpRoot);

    const srcIndex = path.join(payloadRoot, 'src', 'index.html');
    if (!fileExists(srcIndex)) {
      const err = new Error('SRC_INDEX_MISSING');
      err.code = 'SRC_INDEX_MISSING';
      err.details = { hint: 'ZIP must contain src/index.html for Live Demo to work.' };
      throw err;
    }

    validateExtractedTree(payloadRoot);

    const targetDir = path.join(destRoot, slug);
    ensureDirSync(targetDir);

    const entries = fs.readdirSync(payloadRoot, { withFileTypes: true });
    for (const entry of entries) {
      fs.cpSync(path.join(payloadRoot, entry.name), path.join(targetDir, entry.name), {
        recursive: true,
        force: true,
      });
    }

    return { targetDir };
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_e) {
      // ignore cleanup errors
    }
  }
}

module.exports = {
  // main APIs
  validateTemplateZipOrThrowAsync,
  extractPreviewPngToFile,
  extractFullTemplateToUploadDir,

  // low-level (might be useful later)
  runUnzipList,
  extractZipEntryToBuffer,
};
