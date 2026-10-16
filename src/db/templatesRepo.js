// src/db/templatesRepo.js
'use strict';

import fs from 'node:fs';
import path from 'node:path';

const TEMPLATES_ROOT = path.resolve(process.cwd(), 'storage', 'templates');
const ZIPS_DIR = path.resolve(process.cwd(), 'storage', 'zips');

function normalizeLicense(raw) {
  if (!raw) return 'PU';
  const v = String(raw).trim().toUpperCase();
  if (v === 'FREE') return 'FREE';
  if (v === 'PERSONAL' || v === 'PU') return 'PU';
  if (v === 'COMMERCIAL' || v === 'CU') return 'CU';
  if (v === 'EXTENDED' || v === 'EL') return 'EL';
  return v;
}

function normalizeType(raw) {
  if (!raw) return 'buy';
  const v = String(raw).trim().toLowerCase();
  if (['buy', 'rent', 'free'].includes(v)) return v;
  return 'buy';
}

function computeHasZip(slug) {
  // expecting: storage/zips/seed-001_v1.0.0.zip (any v*)
  if (!fs.existsSync(ZIPS_DIR)) return false;
  const prefix = `${slug}_v`;
  try {
    const files = fs.readdirSync(ZIPS_DIR);
    return files.some((name) => name.startsWith(prefix) && name.endsWith('.zip'));
  } catch {
    return false;
  }
}

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

      const license = normalizeLicense(meta.license);
      const type = normalizeType(meta.type);

      result.push({
        slug,
        title: meta.title ?? slug,
        category: meta.category ?? '',
        price: meta.price ?? 0,
        version: meta.version ?? '',
        description: meta.description ?? '',
        license,
        type,
        preview: `/seeds/${slug}/preview/preview.png`,
        hasZip: computeHasZip(slug),
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

    const license = normalizeLicense(meta.license);
    const type = normalizeType(meta.type);

    return {
      slug,
      title: meta.title ?? slug,
      category: meta.category ?? '',
      price: meta.price ?? 0,
      version: meta.version ?? '',
      description: meta.description ?? '',
      license,
      type,
      preview: `/seeds/${slug}/preview/preview.png`,
      hasZip: computeHasZip(slug),
    };
  } catch (err) {
    console.warn(`[templatesRepo] broken metadata in ${slug}:`, err.message);
    return null;
  }
}
