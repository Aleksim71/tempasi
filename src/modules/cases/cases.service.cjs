'use strict';

const repo = require('./cases.repo.cjs');

async function getOwnerCases(userId) {
  return repo.listByOwner(userId);
}

async function create(userId, payload) {
  return repo.createCase({
    ownerUserId: userId,
    title: payload.title,
    clientName: payload.clientName,
    note: payload.note,
  });
}

module.exports = {
  getOwnerCases,
  create,
};
