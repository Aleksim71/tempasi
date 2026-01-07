// src/db/templatesRepo.js
'use strict';

import fs from 'node:fs';
import path from 'node:path';

const TEMPLATES_ROOT = path.resolve(process.cwd(), 'storage', 'templates');

export async function getAllTemplates() {
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
        category: meta.category ?? '',
        price: meta.price ?? 0,
        version: meta.version ?? '',
        description: meta.description ?? '',

        // B7:
        license: meta.license ?? 'PU', // PU/CU/EL/FREE
        type: meta.type ?? 'buy', // buy/rent/free

        preview: `/seeds/${slug}/preview/preview.png`,
      });
    } catch (err) {
      console.warn(`[templatesRepo] broken metadata in ${slug}:`, err.message);
    }
  }

  return result;
}

export async function getTemplateBySlug(slug) {
  const dir = path.join(TEMPLATES_ROOT, slug);
  const metaPath = path.join(dir, 'metadata.json');

  if (!fs.existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

    return {
      slug,
      title: meta.title ?? slug,
      category: meta.category ?? '',
      price: meta.price ?? 0,
      version: meta.version ?? '',
      description: meta.description ?? '',

      // B7:
      license: meta.license ?? 'PU',
      type: meta.type ?? 'buy',

      preview: `/seeds/${slug}/preview/preview.png`,
    };
  } catch (err) {
    console.warn(`[templatesRepo] broken metadata in ${slug}:`, err.message);
    return null;
  }
}
