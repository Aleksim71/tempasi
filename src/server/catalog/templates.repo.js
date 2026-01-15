// src/server/catalog/templates.repo.js
import fs from 'node:fs/promises';
import path from 'node:path';

const TEMPLATES_ROOT = path.resolve(process.cwd(), 'storage', 'templates');
const ZIPS_ROOT = path.resolve(process.cwd(), 'storage', 'zips');

function toStr(v) {
  return v == null ? '' : String(v);
}

async function safeReadJson(absPath) {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function safeReaddir(absPath) {
  try {
    return await fs.readdir(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeLicense(meta) {
  const license = toStr(meta?.license || meta?.tier || meta?.plan)
    .trim()
    .toUpperCase();
  return license || '';
}

/**
 * WEB catalog feed.
 *
 * IMPORTANT:
 *  - Legacy UI (templates.hbs / templates.filters.js) builds preview paths using {{id}}
 *  - Previously id was 1..N → browser requested /t/1/... (404)
 *  - Fix: id MUST equal folder slug (seed-001, seed-002, ...)
 */
export async function getTemplatesCatalog() {
  const dirents = await safeReaddir(TEMPLATES_ROOT);

  const slugs = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name && !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  // Scan zips once
  const zipEntries = await safeReaddir(ZIPS_ROOT);
  const zipNames = zipEntries.filter((e) => e.isFile()).map((e) => e.name);

  const templates = [];

  for (const slug of slugs) {
    const metaPath = path.join(TEMPLATES_ROOT, slug, 'metadata.json');
    const meta = await safeReadJson(metaPath);

    const name =
      toStr(meta?.name).trim() ||
      toStr(meta?.title).trim() ||
      toStr(meta?.displayName).trim() ||
      slug;

    const license = normalizeLicense(meta);

    const prefix = `${slug}_v`;
    const zipReady = zipNames.some((n) => n.startsWith(prefix) && n.endsWith('.zip'));

    const isFree =
      Boolean(meta?.isFree) ||
      toStr(meta?.dealType).toLowerCase() === 'free' ||
      toStr(meta?.price).trim() === '0';

    templates.push({
      // ✅ KEY FIX: keep legacy "id", but make it the slug so URLs become /t/seed-001/...
      id: slug,

      // modern field (useful for future refactors)
      slug,

      name,
      license,
      zipReady,
      isFree,

      meta: meta || undefined,
    });
  }

  return templates;
}

export default {
  getTemplatesCatalog,
};
