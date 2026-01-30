// src/web/routes/templates.routes.js
import { Router } from 'express';
import * as repo from '../../server/catalog/templates.repo.js';

function pickCatalogFn() {
  // 1) Named exports
  if (typeof repo.selectTemplatesForCatalog === 'function') return repo.selectTemplatesForCatalog;
  if (typeof repo.getTemplatesCatalog === 'function') return repo.getTemplatesCatalog;

  // 2) Default export (common pattern: export default { ... })
  if (repo.default && typeof repo.default.selectTemplatesForCatalog === 'function') {
    return repo.default.selectTemplatesForCatalog;
  }
  if (repo.default && typeof repo.default.getTemplatesCatalog === 'function') {
    return repo.default.getTemplatesCatalog;
  }

  const available = Object.keys(repo).sort().join(', ');
  throw new Error(
    `[templates.routes] Cannot find catalog function in templates.repo.js. ` +
      `Expected selectTemplatesForCatalog or getTemplatesCatalog. Available exports: ${available}`,
  );
}

export function createTemplatesRouter() {
  const router = Router();
  const selectCatalog = pickCatalogFn();

  router.get('/', async (req, res, next) => {
    try {
      const db = req.app.locals?.db;

      // If repo fn expects an argument, pass db; otherwise call without args.
      const templates = await (selectCatalog.length >= 1 ? selectCatalog(db) : selectCatalog());

      res.render('pages/templates/index', {
        title: 'Templates — Tempasi',
        bodyClass: 'templates-page',
        activePage: 'templates',
        styles: ['/css/pages/catalog.css'],
        templates,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
