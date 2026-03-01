/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');
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

module.exports = {
  // main APIs
  validateTemplateZipOrThrowAsync,
  extractPreviewPngToFile,

  // low-level (might be useful later)
  runUnzipList,
  extractZipEntryToBuffer,
};
