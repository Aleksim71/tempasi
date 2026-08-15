// src/server/downloads/findZipForSlug.js
'use strict';

import fs from 'node:fs';
import path from 'node:path';

const ZIPS_DIR = path.resolve(process.cwd(), 'storage', 'zips');

function isSafeSlug(slug) {
  // guard against path traversal and other weird values
  return typeof slug === 'string' && /^seed-\d{3}$/.test(slug);
}

/**
 * Finds a zip by slug in storage/zips
 * Expected format: seed-001_v1.0.0.zip
 *
 * Returns:
 * { absPath, fileName } | null
 */
export function findZipForSlug(slug) {
  if (!isSafeSlug(slug)) return null;
  if (!fs.existsSync(ZIPS_DIR)) return null;

  const prefix = `${slug}_v`;

  const files = fs
    .readdirSync(ZIPS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.zip'))
    .sort((a, b) => a.localeCompare(b, 'en')); // stable

  if (!files.length) return null;

  // take the "latest" one (usually the most recent version for a given name pattern)
  const fileName = files[files.length - 1];
  const absPath = path.join(ZIPS_DIR, fileName);

  return { absPath, fileName };
}
