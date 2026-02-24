'use strict';

const repo = require('./repos/entitlements.cabinet.repo.cjs');

/**
 * Cabinet: "My Templates" workspace
 * Returns list + small stats for SSR render.
 */

async function getMyTemplatesWorkspace(userId) {
  const [items, stats] = await Promise.all([
    repo.listByUserWithTemplates(userId),
    repo.countActiveByUser(userId),
  ]);

  return {
    items,
    stats, // { active_entitlements }
  };
}

module.exports = {
  getMyTemplatesWorkspace,
};
