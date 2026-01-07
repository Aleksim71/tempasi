// src/server/downloads/findZipForSlug.js
'use strict';

import fs from 'node:fs';
import path from 'node:path';

const ZIPS_DIR = path.resolve(process.cwd(), 'storage', 'zips');

function isSafeSlug(slug) {
  // не даём path traversal и всякие странные значения
  return typeof slug === 'string' && /^seed-\d{3}$/.test(slug);
}

/**
 * Находит zip по slug в storage/zips
 * Ожидаемый формат: seed-001_v1.0.0.zip
 *
 * Возвращает:
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
    .sort((a, b) => a.localeCompare(b, 'en')); // стабильно

  if (!files.length) return null;

  // берём “последний” (обычно это самая свежая версия при одинаковом шаблоне имени)
  const fileName = files[files.length - 1];
  const absPath = path.join(ZIPS_DIR, fileName);

  return { absPath, fileName };
}
