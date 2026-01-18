#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

// where your source svg files live:
const SRC_DIR = path.join(ROOT, 'public', 'icons', 'sprite', 'tempasi');
// output sprite:
const OUT_FILE = path.join(ROOT, 'public', 'icons', 'tempasi-sprite.svg');

// file -> symbol id mapping (stable ids for <use>)
const ID_MAP = new Map([
  ['profile-striped.svg', 'tp-header-profile'],
  ['cart-striped.svg', 'tp-header-cart'],

  ['status-zip-ready-striped.svg', 'tp-status-zip-ready'],
  ['status-zip-not-ready-striped.svg', 'tp-status-zip-not-ready'],

  ['badge-PU-striped.svg', 'tp-badge-pu'],
  ['badge-CU-striped.svg', 'tp-badge-cu'],
  ['badge-EL-striped.svg', 'tp-badge-el'],
  ['badge-ML-striped.svg', 'tp-badge-ml'],
  ['badge-EX-striped.svg', 'tp-badge-ex'],

  ['action-preview-striped.svg', 'tp-action-preview'],
  ['action-buy-striped.svg', 'tp-action-buy'],
  ['action-download-striped.svg', 'tp-action-download'],
]);

function readSvg(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');

  // Extract viewBox (fallback if missing)
  const vbMatch = raw.match(/viewBox\s*=\s*"([^"]+)"/i);
  const viewBox = vbMatch ? vbMatch[1] : '0 0 64 48';

  // Extract inner content between <svg ...> and </svg>
  const innerMatch = raw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (!innerMatch) {
    throw new Error(`Invalid SVG (no <svg> wrapper): ${path.basename(filePath)}`);
  }

  const inner = innerMatch[1]
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .trim();

  return { viewBox, inner };
}

function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function indent(s, spaces) {
  const pad = ' '.repeat(spaces);
  return s
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n');
}

/**
 * Prefix internal ids (mask/clipPath/pattern/gradient/etc.) to avoid collisions in a single sprite.
 * Also rewrites references: url(#id), href="#id", xlink:href="#id", etc.
 */
function prefixInternalIds(svgInner, prefix) {
  // 1) collect all ids
  const ids = new Set();
  const idRe = /\sid="([^"]+)"/g;
  let m;
  while ((m = idRe.exec(svgInner)) !== null) ids.add(m[1]);

  if (ids.size === 0) return svgInner;

  let out = svgInner;

  // 2) rewrite id="X" -> id="prefix--X"
  // use a safe regex per id to avoid partial matches
  for (const id of ids) {
    const escaped = escapeRegExp(id);

    // id="id"
    out = out.replace(new RegExp(`\\sid="${escaped}"`, 'g'), ` id="${prefix}--${id}"`);

    // url(#id) in any attribute
    out = out.replace(new RegExp(`url\\(#${escaped}\\)`, 'g'), `url(#${prefix}--${id})`);

    // href="#id" or xlink:href="#id"
    out = out.replace(new RegExp(`(href|xlink:href)="#${escaped}"`, 'g'), `$1="#${prefix}--${id}"`);

    // Some SVGs reference ids without url(): mask="id", clip-path="id" (rare but happens)
    out = out.replace(new RegExp(`(mask|clip-path|filter|fill|stroke)="\\s*#${escaped}\\s*"`, 'g'), `$1="#${prefix}--${id}"`);
  }

  return out;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Source folder not found: ${SRC_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.toLowerCase().endsWith('.svg'))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    console.error(`No SVG files found in: ${SRC_DIR}`);
    process.exit(1);
  }

  const unknown = files.filter((f) => !ID_MAP.has(f));
  if (unknown.length) {
    console.error('These SVG files are not in ID_MAP (add mapping first):');
    unknown.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  }

  // Build <symbol> list
  const symbols = files.map((filename) => {
    const id = ID_MAP.get(filename);
    const fp = path.join(SRC_DIR, filename);
    const { viewBox, inner } = readSvg(fp);

    // IMPORTANT: prefix internal ids to avoid collisions in the sprite
    const safeInner = prefixInternalIds(inner, id);

    return `  <symbol id="${id}" viewBox="${viewBox}">\n${indent(safeInner, 4)}\n  </symbol>`;
  });

  const sprite =
`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg">
${symbols.join('\n')}
</svg>
`;

  ensureDirExists(path.dirname(OUT_FILE));
  fs.writeFileSync(OUT_FILE, sprite, 'utf8');

  console.log(`[icons] OK: built sprite -> ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`[icons] Symbols: ${files.length}`);
}

main();
