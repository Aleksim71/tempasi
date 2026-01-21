// src/web/routes/download.routes.js
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';

function safeSlug(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

async function findZipForSlug(zipsDir, slug) {
  // поддержка:
  // - seed-001.zip
  // - seed-001_v1.0.0.zip
  // - seed-001-v1.0.0.zip
  const items = await fs.readdir(zipsDir);
  const matches = items
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .filter((f) => f === `${slug}.zip` || f.startsWith(`${slug}_`) || f.startsWith(`${slug}-`))
    // стабильно выбираем "самый свежий" по mtime
    .map((name) => ({ name, abs: path.join(zipsDir, name) }));

  if (matches.length === 0) return null;

  const stats = await Promise.all(
    matches.map(async (m) => {
      try {
        const st = await fs.stat(m.abs);
        return { ...m, mtimeMs: st.mtimeMs || 0 };
      } catch {
        return { ...m, mtimeMs: 0 };
      }
    }),
  );

  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0]; // { name, abs, mtimeMs }
}

/**
 * createDownloadRoutes({ zipsDir })
 * - GET /download/:slug  -> отдаёт zip из storage/zips
 */
export function createDownloadRoutes(options = {}) {
  const router = express.Router();

  const zipsDir = options.zipsDir || path.join(process.cwd(), 'storage', 'zips');

  router.get('/download/:slug', async (req, res, next) => {
    try {
      const slug = safeSlug(req.params.slug);
      if (!slug) return res.status(404).type('text/plain').send('Not found');

      const found = await findZipForSlug(zipsDir, slug);
      if (!found) return res.status(404).type('text/plain').send('Not found');

      // нормальное имя в диалоге скачивания
      const downloadName = found.name;

      // res.download сам выставит заголовки и отправит файл
      return res.download(found.abs, downloadName);
    } catch (e) {
      return next(e);
    }
  });

  return router;
}
