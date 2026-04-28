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

async function deleteCase(userId, caseId, db) {
  return repo.deleteOwnedCase({ ownerUserId: userId, caseId }, db);
}

module.exports = {
  LAST_CASE_DELETE_MESSAGE,
  getOwnerCases,
  create,
  ensureDefaultCaseForUser,
  deleteCase,
};
