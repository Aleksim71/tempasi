'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'storage', 'templates');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function defaultForSlug(slug) {
  // Тюнинг по желанию. Сейчас — безопасные дефолты:
  // - license: PU
  // - deal: BUY
  // - zipReady: true (для seed-001..010 у тебя ZIP-ы уже собираются)
  return {
    license: 'PU',
    deal: 'BUY',
    zipReady: true,
  };
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.error('[b11] storage/templates not found:', ROOT);
    process.exit(1);
  }

  const dirs = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('seed-'))
    .map((d) => d.name)
    .sort();

  let changed = 0;

  for (const slug of dirs) {
    const metaPath = path.join(ROOT, slug, 'metadata.json');
    if (!fs.existsSync(metaPath)) {
      console.warn('[b11] skip, metadata missing:', metaPath);
      continue;
    }

    const meta = readJson(metaPath);
    const def = defaultForSlug(slug);

    const next = {
      ...meta,
      license: meta.license ?? def.license,
      deal: meta.deal ?? (meta.license === 'FREE' ? 'FREE' : def.deal),
      zipReady: meta.zipReady ?? def.zipReady,
    };

    const before = JSON.stringify(meta);
    const after = JSON.stringify(next);
    if (before !== after) {
      writeJson(metaPath, next);
      changed++;
      console.log('[b11] patched:', slug);
    }
  }

  console.log(`[b11] done. changed: ${changed}`);
}

main();
