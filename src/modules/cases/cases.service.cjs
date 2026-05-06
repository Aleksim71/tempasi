'use strict';

// src/modules/cases/cases.service.cjs

const repo = require('./cases.repo.cjs');

const LAST_CASE_DELETE_MESSAGE =
  'You need at least one case to use Tempasi. Create another case before deleting this one.';

async function getOwnerCases(userId, db) {
  return repo.listByOwner(userId, db);
}

async function create(userId, payload, db) {
  return repo.createCase(
    {
      ownerUserId: userId,
      title: payload.title,
      clientName: payload.clientName,
      note: payload.note,
    },
    db
  );
}

async function ensureDefaultCaseForUser(userId, db) {
  return repo.ensureDefaultCase(userId, db);
}

async function listOwnedCaseIds(userId, caseIds, db) {
  return repo.listOwnedCaseIds(userId, caseIds, db);
}

async function getOwnedCase(userId, caseId, db) {
  return repo.getOwnedCaseById({ ownerUserId: userId, caseId }, db);
}

async function getPublicPreviewCase(caseId, token, db) {
  return repo.getPublicPreviewCaseByToken({ caseId, token }, db);
}

async function listCaseTemplates(userId, caseId, db) {
  return repo.listCaseTemplates({ ownerUserId: userId, caseId }, db);
}

async function listPublicPreviewTemplates(caseId, token, db) {
  return repo.listPublicPreviewTemplates({ caseId, token }, db);
}

async function listAvailableCasesForOrder(userId, orderId, db) {
  return repo.listAvailableCasesForOrder({ ownerUserId: userId, orderId }, db);
}

async function clearCase(userId, caseId, db) {
  return repo.clearOwnedCaseAssignments({ ownerUserId: userId, caseId }, db);
}


async function deleteCase(userId, caseId, db) {
  return repo.deleteOwnedCase({ ownerUserId: userId, caseId }, db);
}

module.exports = {
  LAST_CASE_DELETE_MESSAGE,
  getOwnerCases,
  create,
  ensureDefaultCaseForUser,
  listOwnedCaseIds,
  getOwnedCase,
  getPublicPreviewCase,
  listCaseTemplates,
  listPublicPreviewTemplates,
  listAvailableCasesForOrder,
  clearCase,
  deleteCase,
};
