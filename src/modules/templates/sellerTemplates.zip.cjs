/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

function listZipEntries(zipPath) {
  if (!zipPath) throw new Error('ZIP_PATH_REQUIRED');
  if (!fs.existsSync(zipPath)) throw new Error('ZIP_NOT_FOUND');

  // unzip -Z1 prints file list (one per line)
  const r = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });

  if (r.error) {
    const err = new Error(`UNZIP_LIST_FAILED: ${r.error.message}`);
    err.code = 'UNZIP_LIST_FAILED';
    throw err;
  }

  // unzip returns non-zero on errors
  if (r.status !== 0) {
    const err = new Error(`UNZIP_LIST_FAILED: ${String(r.stderr || '').trim() || 'unknown error'}`);
    err.code = 'UNZIP_LIST_FAILED';
    throw err;
  }

  const lines = String(r.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  return lines;
}

function findRequiredEntries(entries) {
  // We accept required files anywhere in the ZIP:
  // - preview/preview.png OR preview.png
  // - index.html OR src/index.html
  // (with optional leading folder like seed-001/...)
  const lower = entries.map((e) => String(e).replace(/\\/g, '/'));

  // preview candidates (prefer preview/preview.png)
  const previewA = lower.find((p) => /(^|\/)preview\/preview\.png$/i.test(p));
  const previewB = lower.find((p) => /(^|\/)preview\.png$/i.test(p));
  const previewEntry = previewA || previewB || null;

  // index candidates (prefer index.html in root of package, then src/index.html)
  const indexA = lower.find((p) => /(^|\/)index\.html$/i.test(p));
  const indexB = lower.find((p) => /(^|\/)src\/index\.html$/i.test(p));
  const indexEntry = indexA || indexB || null;

  return { previewEntry, indexEntry };
}

function isValidPngSignature(buf) {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (!buf || buf.length < 8) return false;
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

async function extractZipEntryToFile({ zipPath, entryPath, outPath }) {
  if (!zipPath) throw new Error('ZIP_PATH_REQUIRED');
  if (!entryPath) throw new Error('ZIP_ENTRY_REQUIRED');
  if (!outPath) throw new Error('OUT_PATH_REQUIRED');

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Use unzip -p to stream binary file safely
  await new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', zipPath, entryPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const ws = fs.createWriteStream(outPath);
    let stderr = '';

    child.stderr.on('data', (d) => {
      stderr += String(d);
    });

    child.on('error', (e) => reject(e));
    ws.on('error', (e) => reject(e));

    child.stdout.pipe(ws);

    child.on('close', (code) => {
      ws.end(() => {
        if (code !== 0) {
          const err = new Error(`UNZIP_EXTRACT_FAILED: ${String(stderr).trim() || 'unknown error'}`);
          err.code = 'UNZIP_EXTRACT_FAILED';
          return reject(err);
        }
        resolve();
      });
    });
  });

  // quick integrity check for PNG
  const head = fs.readFileSync(outPath).subarray(0, 16);
  if (!isValidPngSignature(head)) {
    // remove bad file to avoid confusing UI
    try {
      fs.unlinkSync(outPath);
    } catch (_) {}
    const err = new Error('PREVIEW_PNG_INVALID');
    err.code = 'PREVIEW_PNG_INVALID';
    throw err;
  }
}

function validateTemplateZipOrThrow(zipPath) {
  const entries = listZipEntries(zipPath);
  const { previewEntry, indexEntry } = findRequiredEntries(entries);

  const errors = {};
  if (!previewEntry) {
    errors.templateZip = 'ZIP must contain preview/preview.png (or preview.png).';
  }
  if (!indexEntry) {
    errors.templateZip = (errors.templateZip ? errors.templateZip + ' ' : '') +
      'ZIP must contain index.html (or src/index.html).';
  }

  if (Object.keys(errors).length) {
    const err = new Error('ZIP_CONTRACT_FAILED');
    err.code = 'ZIP_CONTRACT_FAILED';
    err.details = { errors, previewEntry, indexEntry };
    throw err;
  }

  return { previewEntry, indexEntry };
}

module.exports = {
  listZipEntries,
  validateTemplateZipOrThrow,
  extractZipEntryToFile,
};
