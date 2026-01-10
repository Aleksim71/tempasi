#!/usr/bin/env node
'use strict';

/**
 * Tempasi Seed Pack — Template structure validator
 *
 * Usage:
 *   node scripts/check-template.js storage/templates/seed-001
 *   node scripts/check-template.js seed-001
 *
 * Exit codes:
 *   0 ok
 *   1 validation error
 *   2 unexpected error
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TEMPLATES_ROOT = path.join(ROOT, 'storage', 'templates');

const ALLOWED_LICENSES = new Set(['PU', 'CU', 'EL', 'SL', 'ML', 'EX', 'RF']);
const REQUIRED_META_KEYS = [
  'id',
  'slug',
  'title',
  'category',
  'pages',
  'tech',
  'price_cents',
  'license_default',
  'author',
  'version'
];

function die(msg, code = 1) {
  console.error(`[check-template] ${msg}`);
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
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(`Invalid JSON: ${p} (${e.message})`);
  }
}

function assert(cond, msg) {
  if (!cond) die(msg);
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    die('Missing template path or id. Example: node scripts/check-template.js seed-001');
  }

  const templateDir = path.isAbsolute(arg)
    ? arg
    : (arg.includes(path.sep) ? path.join(ROOT, arg) : path.join(TEMPLATES_ROOT, arg));

  assert(exists(templateDir), `Template folder not found: ${templateDir}`);

  const metaPath = path.join(templateDir, 'metadata.json');
  const docsReadme = path.join(templateDir, 'docs', 'README.md');
  const srcDir = path.join(templateDir, 'src');
  const assetsDir = path.join(templateDir, 'assets');
  const previewDir = path.join(templateDir, 'preview');
  const distDir = path.join(templateDir, 'dist');

  assert(exists(metaPath), `Missing metadata.json: ${metaPath}`);
  assert(exists(srcDir), `Missing src/ folder: ${srcDir}`);
  assert(exists(docsReadme), `Missing docs/README.md: ${docsReadme}`);

  const meta = readJson(metaPath);

  // Required keys
  for (const k of REQUIRED_META_KEYS) {
    assert(Object.prototype.hasOwnProperty.call(meta, k), `metadata.json missing key: "${k}"`);
  }

  // Basic types
  assert(typeof meta.id === 'string' && meta.id.trim(), 'metadata.id must be a non-empty string');
  assert(typeof meta.slug === 'string' && meta.slug.trim(), 'metadata.slug must be a non-empty string');
  assert(typeof meta.title === 'string' && meta.title.trim(), 'metadata.title must be a non-empty string');
  assert(typeof meta.category === 'string' && meta.category.trim(), 'metadata.category must be a non-empty string');
  assert(Array.isArray(meta.pages) && meta.pages.length > 0, 'metadata.pages must be a non-empty array');
  assert(Array.isArray(meta.tech) && meta.tech.length > 0, 'metadata.tech must be a non-empty array');
  assert(Number.isInteger(meta.price_cents) && meta.price_cents >= 0, 'metadata.price_cents must be an integer >= 0');
  assert(typeof meta.license_default === 'string' && meta.license_default.trim(), 'metadata.license_default must be a string');
  assert(typeof meta.author === 'string' && meta.author.trim(), 'metadata.author must be a non-empty string');
  assert(typeof meta.version === 'string' && meta.version.trim(), 'metadata.version must be a non-empty string');

  // License value
  assert(ALLOWED_LICENSES.has(meta.license_default), `metadata.license_default must be one of: ${[...ALLOWED_LICENSES].join(', ')}`);

  // Folder name consistency (soft rule: warn, don't fail)
  const folderName = path.basename(templateDir);
  if (folderName !== meta.id && folderName !== meta.slug) {
    console.warn(`[check-template] WARN: folder name "${folderName}" differs from id "${meta.id}" and slug "${meta.slug}"`);
  }

  // Pages existence
  for (const rel of meta.pages) {
    assert(typeof rel === 'string' && rel.trim(), 'metadata.pages must contain non-empty strings');
    const pagePath = path.join(srcDir, rel);
    assert(exists(pagePath), `Page not found: src/${rel}`);
  }

  // Recommended folders (warn only)
  if (!exists(assetsDir)) console.warn('[check-template] WARN: assets/ folder is missing (ok for simple templates)');
  if (!exists(previewDir)) console.warn('[check-template] WARN: preview/ folder is missing (add later)');
  if (!exists(distDir)) console.warn('[check-template] WARN: dist/ folder is missing (build-zip will package src/assets/docs)');

  console.log('[check-template] OK:', meta.id, `v${meta.version}`);
}

try {
  main();
} catch (e) {
  console.error('[check-template] Unexpected error:', e);
  process.exit(2);
}
