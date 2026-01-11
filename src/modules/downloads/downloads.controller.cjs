'use strict';

const { hasEntitlement } = require('../entitlements/entitlements.repo.cjs');
const downloadsService = require('./downloads.service.cjs');

function requireAuthCookie(req) {
  if (!req.user || !req.user.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}

function pickDownloadFn(service) {
  // Поддерживаем несколько возможных имен, чтобы не гадать.
  // Возвращаем первую найденную.
  const candidates = [
    'getZipPathBySlug',
    'getZipPathForSlug',
    'getZipPath',
    'resolveZipPathBySlug',
    'resolveZipPath',
    'buildZipPathBySlug',
    'buildZipPath',
  ];

  for (const name of candidates) {
    if (typeof service[name] === 'function') return service[name];
  }

  // Ещё вариант: service.downloadTemplate({ slug }) возвращает { path, filename }
  if (typeof service.downloadTemplate === 'function') return service.downloadTemplate;

  return null;
}

async function downloadTemplate(req, res, next) {
  try {
    requireAuthCookie(req);

    const db = req.app.locals.db;
    const userId = req.user.id;

    const templateSlug = String(req.params.slug || '').trim();
    if (!templateSlug) {
      const err = new Error('Bad Request: missing slug');
      err.status = 400;
      throw err;
    }

    const ok = await hasEntitlement({ db, userId, templateSlug });
    if (!ok) {
      const err = new Error('Forbidden: no entitlement for this template');
      err.status = 403;
      throw err;
    }

    const fn = pickDownloadFn(downloadsService);
    if (!fn) {
      const err = new Error(
        'downloads.controller: cannot find download resolver in downloads.service.cjs (expected getZipPathBySlug/getZipPath/...)'
      );
      err.status = 500;
      throw err;
    }

    // 1) Если это downloadTemplate(...) которая сама шлёт/возвращает объект
    if (fn === downloadsService.downloadTemplate) {
      const result = await fn({ slug: templateSlug, req, res });
      // Если сервис сам отправил ответ — просто выходим
      if (res.headersSent) return;

      // Если сервис вернул { path, filename }
      if (result && typeof result === 'object' && result.path) {
        const filename = result.filename || `${templateSlug}.zip`;
        return res.download(result.path, filename);
      }

      // Если сервис вернул строку (путь)
      if (typeof result === 'string') {
        return res.download(result, `${templateSlug}.zip`);
      }

      const err = new Error('downloads.controller: downloadsService.downloadTemplate returned unexpected result');
      err.status = 500;
      throw err;
    }

    // 2) Если это функция, которая возвращает путь к zip
    const zipPath = await fn(templateSlug);

    if (!zipPath || typeof zipPath !== 'string') {
      const err = new Error('downloads.controller: zip path not found');
      err.status = 404;
      throw err;
    }

    return res.download(zipPath, `${templateSlug}.zip`);
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  downloadTemplate,
};
