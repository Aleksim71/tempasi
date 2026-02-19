// src/modules/cases/cases.service.cjs
'use strict';

const CasesRepo = require('./cases.repo.cjs');

function mustGetDb({ db }) {
  if (!db || typeof db.query !== 'function') {
    const err = new Error('DB_NOT_WIRED');
    err.status = 500;
    err.code = 'DB_NOT_WIRED';
    throw err;
  }
  return db;
}

function mustUserId(userId) {
  if (userId === null || userId === undefined || String(userId).trim() === '') {
    const err = new Error('UNAUTHORIZED');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return String(userId).trim();
}

async function listMyCases({ db, userId, limit = 20, offset = 0 }) {
  const _db = mustGetDb({ db });
  const uid = mustUserId(userId);
  return await CasesRepo.listCasesByUser(_db, uid, { limit, offset });
}

async function createMyCase({ db, userId, title, notes = null }) {
  const _db = mustGetDb({ db });
  const uid = mustUserId(userId);
  const t = String(title || '').trim();
  if (!t) {
    const err = new Error('TITLE_REQUIRED');
    err.status = 400;
    err.code = 'TITLE_REQUIRED';
    throw err;
  }
  return await CasesRepo.createCase(_db, uid, { title: t, notes });
}

async function getMyCase({ db, userId, caseId }) {
  const _db = mustGetDb({ db });
  const uid = mustUserId(userId);
  if (!caseId) return null;
  return await CasesRepo.getCaseByIdForUser(_db, uid, caseId);
}

async function updateMyCase({ db, userId, caseId, title, notes }) {
  const _db = mustGetDb({ db });
  const uid = mustUserId(userId);
  if (!caseId) {
    const err = new Error('CASE_ID_REQUIRED');
    err.status = 400;
    err.code = 'CASE_ID_REQUIRED';
    throw err;
  }
  return await CasesRepo.updateCase(_db, uid, caseId, { title, notes });
}

async function listMyCaseTemplates({ db, userId, caseId }) {
  const _db = mustGetDb({ db });
  const uid = mustUserId(userId);
  if (!caseId) return [];
  return await CasesRepo.listCaseTemplates(_db, uid, caseId);
}

async function addTemplateToMyCase({ db, userId, caseId, templateId }) {
  const _db = mustGetDb({ db });
  const uid = mustUserId(userId);
  if (!caseId || !templateId) {
    const err = new Error('BAD_ARGS');
    err.status = 400;
    err.code = 'BAD_ARGS';
    throw err;
  }
  return await CasesRepo.addTemplateToCase(_db, uid, caseId, templateId);
}

async function removeTemplateFromMyCase({ db, userId, caseId, templateId }) {
  const _db = mustGetDb({ db });
  const uid = mustUserId(userId);
  if (!caseId || !templateId) {
    const err = new Error('BAD_ARGS');
    err.status = 400;
    err.code = 'BAD_ARGS';
    throw err;
  }
  return await CasesRepo.removeTemplateFromCase(_db, uid, caseId, templateId);
}

module.exports = {
  listMyCases,
  createMyCase,
  getMyCase,
  updateMyCase,
  listMyCaseTemplates,
  addTemplateToMyCase,
  removeTemplateFromMyCase,
};
