// src/server/catalog/templates.repo.js
'use strict';

import fs from 'node:fs';
import path from 'node:path';

const TEMPLATES_ROOT = path.resolve(process.cwd(), 'storage', 'templates');

function isSafeSlug(slug) {
  return typeof slug === 'string' && /^seed-\d{3}$/.test(slug);
}

/**
 * B7-compatible: читает все seed-XXX из storage/templates
 * и возвращает данные для витрины/каталога
 */
export function listTemplates() {
  if (!fs.existsSync(TEMPLATES_ROOT)) return [];

  const dirs = fs
    .readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('seed-'))
    .map((d) => d.name)
    .sort();

  const result = [];

  for (const slug of dirs) {
    const metaPath = path.join(TEMPLATES_ROOT, slug, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

      result.push({
        slug,
        title: meta.title ?? slug,
        price: meta.price ?? 0,
        category: meta.category ?? '',
        version: meta.version ?? '',
        description: meta.description ?? '',

        // B7:
        license: meta.license ?? 'PU',
        type: meta.type ?? 'buy',

        preview: `/seeds/${slug}/preview/preview.png`,
      });
    } catch (err) {
      console.warn(`[catalog] broken metadata in ${slug}:`, err.message);
    }
  }

  return result;
}

/**
 * Один шаблон по slug (для будущих API/страниц)
 */
export function getTemplate(slug) {
  if (!isSafeSlug(slug)) return null;

  const metaPath = path.join(TEMPLATES_ROOT, slug, 'metadata.json');
  if (!fs.existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

    return {
      slug,
      title: meta.title ?? slug,
      price: meta.price ?? 0,
      category: meta.category ?? '',
      version: meta.version ?? '',
      description: meta.description ?? '',

      license: meta.license ?? 'PU',
      type: meta.type ?? 'buy',

      preview: `/seeds/${slug}/preview/preview.png`,
    };
  } catch (err) {
    console.warn(`[catalog] broken metadata in ${slug}:`, err.message);
    return null;
  }
}
