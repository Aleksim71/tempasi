'use strict';

const OrdersService = require('../orders/orders.service.cjs');
const EntitlementsRepo = require('../payments/repos/entitlements.repo.cjs');

async function assertCanDownload(req, slug) {
  const userId = OrdersService.getUserIdFromReq(req);

  const ent = await EntitlementsRepo.findActiveEntitlement({
    userId,
    slug,
  });

  if (!ent) {
    const err = new Error('NO_ENTITLEMENT');
    err.status = 403;
    throw err;
  }

  return ent;
}

module.exports = {
  assertCanDownload,
};
