// src/web/helpers/templateAvailability.cjs
'use strict';

/**
 * TEMPASI_STEP_6F_REAL_UI_SOLD_UNAVAILABLE_BEHAVIOR
 *
 * UI availability normalizer.
 *
 * Business rule:
 * - completed BUY is permanent exclusivity;
 * - sold template must not expose active BUY or RENT CTA;
 * - UI must show explicit sold/unavailable state.
 */
function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeTemplateAvailability(template) {
  if (!template || typeof template !== 'object') {
    return template;
  }

  const soldSignals = [
    template.isSold,
    template.is_sold,
    template.sold,
    template.isUnavailableBecauseSold,
    template.is_unavailable_because_sold,
    template.hasPaidBuy,
    template.has_paid_buy,
    template.hasCompletedBuy,
    template.has_completed_buy,
  ];

  const textualSoldSignals = [
    template.availability,
    template.availabilityStatus,
    template.availability_status,
    template.status,
    template.saleStatus,
    template.sale_status,
    template.buyStatus,
    template.buy_status,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase());

  const timestampSoldSignals = [
    template.soldAt,
    template.sold_at,
    template.purchasedAt,
    template.purchased_at,
    template.boughtAt,
    template.bought_at,
  ];

  const isSold =
    soldSignals.some(truthy) ||
    textualSoldSignals.some((value) =>
      value === 'sold' ||
      value === 'unavailable' ||
      value === 'purchased' ||
      value === 'bought' ||
      value === 'completed_buy' ||
      value === 'completed-buy'
    ) ||
    timestampSoldSignals.some((value) => Boolean(value));

  const rentEnabled =
    template.rentEnabled !== false &&
    template.rent_enabled !== false &&
    template.allowRent !== false &&
    template.allow_rent !== false &&
    template.canBeRented !== false &&
    template.can_be_rented !== false;

  const buyEnabled =
    template.buyEnabled !== false &&
    template.buy_enabled !== false &&
    template.allowBuy !== false &&
    template.allow_buy !== false &&
    template.canBeBought !== false &&
    template.can_be_bought !== false;

  return {
    ...template,
    isSold,
    is_sold: isSold,
    availabilityStatus: isSold ? 'sold' : (template.availabilityStatus || template.availability_status || 'available'),
    availabilityLabel: isSold ? 'Sold / no longer available' : (template.availabilityLabel || template.availability_label || 'Available'),
    canBuy: !isSold && buyEnabled,
    canRent: !isSold && rentEnabled,
  };
}

function normalizeTemplateListAvailability(templates) {
  if (!Array.isArray(templates)) {
    return templates;
  }

  return templates.map(normalizeTemplateAvailability);
}

module.exports = {
  normalizeTemplateAvailability,
  normalizeTemplateListAvailability,
};
