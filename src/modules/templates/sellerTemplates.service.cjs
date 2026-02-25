/* eslint-env node */
'use strict';

const repo = require('./sellerTemplates.repo.cjs');

function validateAddTemplateForm(body = {}) {
  const errors = {};
  const data = {
    title: String(body.title || '').trim(),
    slug: String(body.slug || '').trim(),
    shortDescription: String(body.shortDescription || '').trim(),
    priceBuy: String(body.priceBuy || '').trim(),
    priceRent: String(body.priceRent || '').trim(),
    status: String(body.status || 'draft').trim(),
  };

  if (!data.title) errors.title = 'Title is required.';

  const normSlug = repo.normalizeSlug(data.slug);
  if (!normSlug) errors.slug = 'Slug is required (letters/numbers/dashes).';

  if (data.priceBuy) {
    const cents = repo.toCentsOrNull(data.priceBuy);
    if (cents === null) errors.priceBuy = 'Buy price must be a non-negative number.';
  }

  if (data.priceRent) {
    const cents = repo.toCentsOrNull(data.priceRent);
    if (cents === null) errors.priceRent = 'Rent price must be a non-negative number.';
  }

  if (data.status && !['draft', 'published'].includes(data.status)) {
    data.status = 'draft';
  }

  data.slug = normSlug;

  return { ok: Object.keys(errors).length === 0, errors, data };
}

async function addSellerTemplate({ pool, user, body }) {
  if (!user) throw new Error('AUTH_REQUIRED');

  const ownerUserId = user.id || user.user_id || user.userId;
  if (!ownerUserId) throw new Error('USER_ID_MISSING');

  const v = validateAddTemplateForm(body);
  if (!v.ok) {
    const err = new Error('VALIDATION_FAILED');
    err.code = 'VALIDATION_FAILED';
    err.details = v;
    throw err;
  }

  const created = await repo.insertSellerTemplate({
    pool,
    ownerUserId,
    title: v.data.title,
    slug: v.data.slug,
    shortDescription: v.data.shortDescription || null,
    priceBuy: v.data.priceBuy || null,
    priceRent: v.data.priceRent || null,
    status: v.data.status || 'draft',
  });

  return { created };
}

module.exports = {
  validateAddTemplateForm,
  addSellerTemplate,
};
