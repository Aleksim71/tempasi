// src/server/catalog/templates.repo.js
'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATES_ROOT = path.resolve(process.cwd(), 'seeds');

/**
 * Читает все seed-XXX и возвращает данные для витрины
 */
function listTemplates() {
  if (!fs.existsSync(TEMPLATES_ROOT)) {
    return [];
  }

  const dirs = fs
    .readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('seed-'))
    .map((d) => d.name)
    .sort();

  const result = [];

  for (const dir of dirs) {
    const metaPath = path.join(TEMPLATES_ROOT, dir, 'metadata.json');

    if (!fs.existsSync(metaPath)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

      result.push({
        id: dir,
        title: meta.title,
        price: meta.price,
        category: meta.category,
        version: meta.version,
        preview: `/seeds/${dir}/preview/preview.png`,
        description: meta.description || '',
      });
    } catch (err) {
      console.warn(`[catalog] broken metadata in ${dir}`, err.message);
    }
  }

  return result;
}

module.exports = {
  listTemplates,
};
