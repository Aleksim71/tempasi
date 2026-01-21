#!/usr/bin/env node

/**
 * Tempasi Template Ingest Pipeline
 *
 * Usage:
 *   node ingest-template.js storage/inbox/seed-011.zip
 *
 * Responsibilities:
 *   - Accept ZIP from designers
 *   - Unpack into a temp folder
 *   - Normalize structure (handle extra top-level slug folder)
 *   - Validate:
 *       - src/index.html exists
 *       - preview/preview.png exists
 *       - no forbidden files (node_modules, symlinks, oversized binaries)
 *   - Place into storage/templates/<slug>/
 *   - Generate index.html redirect at storage/templates/<slug>/index.html
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = process.cwd();
const TEMPLATES_ROOT = path.join(ROOT, 'storage', 'templates');

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

function log(msg) {
  console.log(`[ingest-template] ${msg}`);
}

function die(msg, code = 1) {
  console.error(`[ingest-template] ${msg}`);
  process.exit(code);
}

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p) {
  if (!exists(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function readJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function runUnzip(zipPath, destDir) {
  const unzipCmd = process.platform === 'win32' ? null : 'unzip';
  if (!unzipCmd) {
    die('Windows is not supported by this script yet. Use WSL or Linux.');
  }

  // quick check that `unzip` exists
  const which = spawnSync('sh', ['-lc', 'command -v unzip'], { stdio: 'ignore' });
  if (which.status !== 0) {
    die('`unzip` command not found. Install it: sudo apt install unzip', 2);
  }

  const res = spawnSync('unzip', ['-qq', zipPath, '-d', destDir], {
    stdio: 'inherit',
  });
  if (res.error) {
    die(`Failed to run unzip: ${res.error.message}`, 2);
  }
  if (res.status !== 0) {
    die(`unzip exited with code ${res.status}`, res.status || 2);
  }
}

function detectPayloadRoot(stagingDir) {
  const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    // Variant B: zip contains single <slug>/ folder
    return path.join(stagingDir, entries[0].name);
  }
  // Variant A: files/folders directly at root
  return stagingDir;
}

function validateTree(rootDir) {
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const rel = path.relative(rootDir, current) || '.';
    const name = path.basename(current);

    // Disallow node_modules anywhere
    if (name === 'node_modules') {
      die(`Forbidden folder found: ${rel}`);
    }

    const stat = fs.lstatSync(current);

    // Disallow symlinks
    if (stat.isSymbolicLink()) {
      die(`Symlinks are not allowed: ${rel}`);
    }

    if (stat.isDirectory()) {
      const children = fs.readdirSync(current);
      for (const child of children) {
        const childPath = path.join(current, child);
        // Basic traversal guard (should not happen after unzip, but be strict)
        const relChild = path.relative(rootDir, childPath);
        if (relChild.split(path.sep).includes('..')) {
          die(`Path traversal detected: ${relChild}`);
        }
        stack.push(childPath);
      }
      continue;
    }

    if (stat.isFile()) {
      // Size limit for binaries / large assets
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        die(`File too large (> ${MAX_FILE_SIZE_BYTES} bytes): ${rel}`);
      }
    }
  }
}

function writeRedirectIndex(targetDir) {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=./src/" />
    <title>Redirecting…</title>
    <script>location.replace('./src/');</script>
  </head>
  <body>
    Redirecting to <a href="./src/">./src/</a>
  </body>
</html>
`;

  const indexPath = path.join(targetDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf8');
}

function copyPayload(payloadRoot, targetDir) {
  // Node 18+ has fs.cpSync
  fs.cpSync(payloadRoot, targetDir, { recursive: true });
}

function main() {
  const zipArg = process.argv[2];
  if (!zipArg) {
    die('Missing ZIP path. Usage: node ingest-template.js storage/inbox/seed-011.zip');
  }

  const zipPath = path.isAbsolute(zipArg) ? zipArg : path.join(ROOT, zipArg);
  if (!exists(zipPath)) {
    die(`ZIP file not found: ${zipPath}`);
  }

  const baseName = path.basename(zipPath);
  const zipBase = baseName.toLowerCase().endsWith('.zip')
    ? baseName.slice(0, -4)
    : baseName;

  ensureDir(TEMPLATES_ROOT);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tempasi-ingest-'));
  log(`Using temp dir: ${tmpRoot}`);

  let payloadRoot;
  try {
    log(`Unpacking: ${zipPath}`);
    runUnzip(zipPath, tmpRoot);

    payloadRoot = detectPayloadRoot(tmpRoot);
    log(`Payload root: ${payloadRoot}`);

    const metaPath = path.join(payloadRoot, 'metadata.json');
    if (!exists(metaPath)) {
      die(`Missing metadata.json in payload: ${metaPath}`);
    }

    const meta = readJson(metaPath);
    const slug = String(meta.slug || meta.id || zipBase).trim();

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      die(`Invalid slug "${slug}". Expected: lowercase letters, digits, hyphen.`);
    }

    const srcIndex = path.join(payloadRoot, 'src', 'index.html');
    if (!exists(srcIndex)) {
      die(`Missing src/index.html: ${srcIndex}`);
    }

    const previewPng = path.join(payloadRoot, 'preview', 'preview.png');
    if (!exists(previewPng)) {
      die(`Missing preview/preview.png: ${previewPng}`);
    }

    log('Validating file tree...');
    validateTree(payloadRoot);

    const targetDir = path.join(TEMPLATES_ROOT, slug);
    if (exists(targetDir) && fs.readdirSync(targetDir).length > 0) {
      die(`Target template folder already exists and is not empty: ${targetDir}`);
    }

    ensureDir(targetDir);

    log(`Copying payload → ${targetDir}`);
    copyPayload(payloadRoot, targetDir);

    log('Generating index.html redirect');
    writeRedirectIndex(targetDir);

    log(`OK. Template ready at: ${targetDir}`);
    log(`Demo URL (on demo server): /t/${slug}/`);
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      log(`Cleaned temp dir: ${tmpRoot}`);
    } catch {
      // ignore cleanup errors
    }
  }
}

try {
  main();
} catch (err) {
  console.error('[ingest-template] Unexpected error:', err);
  process.exit(2);
}

