#!/usr/bin/env node
'use strict';

/**
 * Tempasi Seed Pack — Zip builder
 *
 * Requires: `zip` command (Info-ZIP) available in PATH.
 * (Ubuntu/Mint: sudo apt install zip)
 *
 * Usage:
 *   node scripts/build-zip.js seed-001
 *   node scripts/build-zip.js storage/templates/seed-001
 *
 * Output:
 *   storage/zips/<slug>_v<version>.zip
 *
 * Packages (by default):
 *   - metadata.json
 *   - docs/ (README etc.)
 *   - src/
 *   - assets/ (if exists)
 *   - preview/ (optional, can be included)
 *
 * If dist/ exists and is non-empty, it will package dist/ instead of src/assets,
 * but still includes docs/ and metadata.json.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const TEMPLATES_ROOT = path.join(ROOT, 'storage', 'templates');
const ZIPS_ROOT = path.join(ROOT, 'storage', 'zips');

function die(msg, code = 1) {
  console.error(`[build-zip] ${msg}`);
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

function isNonEmptyDir(p) {
  try {
    return fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

function readJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) die(`Failed to run ${cmd}: ${res.error.message}`, 2);
  if (res.status !== 0) die(`${cmd} exited with code ${res.status}`, res.status || 1);
}

function main() {
  const arg = process.argv[2];
  if (!arg) die('Missing template path or id. Example: node scripts/build-zip.js seed-001');

  const templateDir = path.isAbsolute(arg)
    ? arg
    : (arg.includes(path.sep) ? path.join(ROOT, arg) : path.join(TEMPLATES_ROOT, arg));

  if (!exists(templateDir)) die(`Template folder not found: ${templateDir}`);

  const metaPath = path.join(templateDir, 'metadata.json');
  if (!exists(metaPath)) die(`Missing metadata.json: ${metaPath}`);

  const meta = readJson(metaPath);
  const slug = meta.slug || meta.id;
  const version = meta.version || '0.0.0';

  if (!exists(ZIPS_ROOT)) fs.mkdirSync(ZIPS_ROOT, { recursive: true });

  const outName = `${slug}_v${version}.zip`;
  const outPath = path.join(ZIPS_ROOT, outName);

  // choose payload
  const distDir = path.join(templateDir, 'dist');
  const srcDir = path.join(templateDir, 'src');
  const assetsDir = path.join(templateDir, 'assets');
  const previewDir = path.join(templateDir, 'preview');
  const docsDir = path.join(templateDir, 'docs');

  const useDist = isNonEmptyDir(distDir);

  const staging = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tempasi-zip-'));
  const payloadRoot = path.join(staging, slug);
  fs.mkdirSync(payloadRoot, { recursive: true });

  // copy helper (node 18+ has fs.cpSync)
  const cp = (from, to) => fs.cpSync(from, to, { recursive: true });

  // always include metadata + docs
  cp(metaPath, path.join(payloadRoot, 'metadata.json'));
  if (exists(docsDir)) cp(docsDir, path.join(payloadRoot, 'docs'));
  else die('Missing docs/ folder (expected docs/README.md). Run check-template first.');

  if (useDist) {
    cp(distDir, path.join(payloadRoot, 'dist'));
  } else {
    if (!exists(srcDir)) die('Missing src/ folder.');
    cp(srcDir, path.join(payloadRoot, 'src'));
    if (exists(assetsDir)) cp(assetsDir, path.join(payloadRoot, 'assets'));
  }

  // include preview if present (optional)
  if (exists(previewDir)) cp(previewDir, path.join(payloadRoot, 'preview'));

  // Build zip using system zip
  // zip -r <outPath> <slug>
  const zipCmd = process.platform === 'win32' ? 'powershell' : 'zip';
  if (zipCmd === 'zip') {
    // Check zip exists
    const which = spawnSync('sh', ['-lc', 'command -v zip'], { stdio: 'ignore' });
    if (which.status !== 0) {
      die('`zip` command not found. Install it: sudo apt install zip', 2);
    }
    // remove existing zip if present
    if (exists(outPath)) fs.unlinkSync(outPath);
    run('sh', ['-lc', `cd "${staging}" && zip -r "${outPath}" "${slug}"`]);
  } else {
    die('Windows is not supported by this script yet. Use WSL or Linux.', 2);
  }

  console.log('[build-zip] OK:', outPath);
}

try {
  main();
} catch (e) {
  console.error('[build-zip] Unexpected error:', e);
  process.exit(2);
}
