'use strict';

// src/web/routes/cabinet.pages.routes.cjs
// Full Cabinet router mounted under /cabinet

const express = require('express');
const CasesService = require('../../modules/cases/cases.service.cjs');

function getUserId(req, res) {
  return (
    req.user?.id ||
    res.locals?.user?.id ||
    res.locals?.session?.userId ||
    null
  );
}

function safeStr(s, max = 160) {
  const v = String(s || '').trim();
  if (!v) return '';
  return v.length > max ? v.slice(0, max) : v;
}

function createCabinetPagesRouter({ db }) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('CABINET_ROUTER_DB_REQUIRED');
  }

  const router = express.Router();

  // ========================================
  // OVERVIEW  ->  /cabinet
  // ========================================
  router.get('/', async (req, res, next) => {
    try {
      const userId = getUserId(req, res);

      const recentCases = await CasesService.listMyCases({
        db,
        userId,
        limit: 3,
        offset: 0,
      });

      return res.status(200).render('pages/cabinet', {
        title: 'Cabinet',
        recentCases,
      });
    } catch (err) {
      return next(err);
    }
  });

  // ========================================
  // FINANCE  ->  /cabinet/finance
  // ========================================
  router.get('/finance', async (_req, res) => {
    return res.status(200).render('pages/cabinet/finance', {
      title: 'Finance',
    });
  });

  // ========================================
  // CASES LIST  ->  /cabinet/cases
  // ========================================
  router.get('/cases', async (req, res, next) => {
    try {
      const userId = getUserId(req, res);

      const items = await CasesService.listMyCases({
        db,
        userId,
        limit: 50,
        offset: 0,
      });

      return res.status(200).render('pages/cabinet/cases/index', {
        title: 'Cases',
        cases: items,
      });
    } catch (err) {
      return next(err);
    }
  });

  // ========================================
  // NEW CASE  ->  /cabinet/cases/new
  // ========================================
  router.get('/cases/new', (_req, res) => {
    return res.status(200).render('pages/cabinet/cases/new', {
      title: 'Create Case',
      form: { title: '', notes: '' },
    });
  });

  router.post(
    '/cases',
    express.urlencoded({ extended: false }),
    async (req, res, next) => {
      try {
        const userId = getUserId(req, res);

        const title = safeStr(req.body?.title);
        const notesRaw = String(req.body?.notes || '').trim();
        const notes = notesRaw ? notesRaw.slice(0, 4000) : null;

        if (!title) {
          return res.status(400).render('pages/cabinet/cases/new', {
            title: 'Create Case',
            error: 'Case name is required.',
            form: {
              title: req.body?.title || '',
              notes: req.body?.notes || '',
            },
          });
        }

        const created = await CasesService.createMyCase({
          db,
          userId,
          title,
          notes,
        });

        return res.redirect(`/cabinet/cases/${created.id}`);
      } catch (err) {
        return next(err);
      }
    },
  );

  // ========================================
  // CASE DETAIL  ->  /cabinet/cases/:id
  // ========================================
  router.get('/cases/:id', async (req, res, next) => {
    try {
      const userId = getUserId(req, res);
      const caseId = req.params.id;

      const c = await CasesService.getMyCase({ db, userId, caseId });
      if (!c) {
        return res.status(404).render('pages/404', { title: 'Not found' });
      }

      const templates = await CasesService.listMyCaseTemplates({ db, userId, caseId });

      return res.status(200).render('pages/cabinet/cases/detail', {
        title: c.title,
        case: c,
        templates,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post(
    '/cases/:id',
    express.urlencoded({ extended: false }),
    async (req, res, next) => {
      try {
        const userId = getUserId(req, res);
        const caseId = req.params.id;

        const title = safeStr(req.body?.title);
        const notesRaw = String(req.body?.notes || '').trim();
        const notes = notesRaw ? notesRaw.slice(0, 4000) : null;

        const updated = await CasesService.updateMyCase({
          db,
          userId,
          caseId,
          title: title || null,
          notes,
        });

        if (!updated) {
          return res.status(404).render('pages/404', { title: 'Not found' });
        }

        return res.redirect(`/cabinet/cases/${caseId}`);
      } catch (err) {
        return next(err);
      }
    },
  );

  // ========================================
  // ADD TEMPLATE TO CASE
  // ========================================
  router.post(
    '/cases/:id/templates',
    express.urlencoded({ extended: false }),
    async (req, res, next) => {
      try {
        const userId = getUserId(req, res);
        const caseId = req.params.id;
        const templateId = safeStr(req.body?.template_id, 200);

        if (!templateId) return res.redirect(`/cabinet/cases/${caseId}`);

        await CasesService.addTemplateToMyCase({ db, userId, caseId, templateId });
        return res.redirect(`/cabinet/cases/${caseId}`);
      } catch (err) {
        return next(err);
      }
    },
  );

  // ========================================
  // REMOVE TEMPLATE FROM CASE
  // ========================================
  router.post(
    '/cases/:id/templates/:templateId/remove',
    async (req, res, next) => {
      try {
        const userId = getUserId(req, res);
        const caseId = req.params.id;
        const templateId = req.params.templateId;

        await CasesService.removeTemplateFromMyCase({ db, userId, caseId, templateId });
        return res.redirect(`/cabinet/cases/${caseId}`);
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

module.exports = { createCabinetPagesRouter };
