/* eslint-env node */
'use strict';

const repo = require('./sellerTemplates.repo.cjs');

function getOwnerUserId(user) {
  if (!user) return null;
  return user.id || user.user_id || user.userId || null;
}

function validateAddOrEditTemplateForm(body = {}) {
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

async function addSellerTemplate({ pool, user, body, file }) {
  if (!user) throw new Error('AUTH_REQUIRED');

  const ownerUserId = getOwnerUserId(user);
  if (!ownerUserId) throw new Error('USER_ID_MISSING');

  const v = validateAddOrEditTemplateForm(body);
  if (!v.ok) {
    const err = new Error('VALIDATION_FAILED');
    err.code = 'VALIDATION_FAILED';
    err.details = v;
    throw err;
  }

  const zipPath = file && file.path ? String(file.path) : null;
  const zipOriginalName = file && file.originalname ? String(file.originalname) : null;

  const created = await repo.insertSellerTemplate({
    pool,
    ownerUserId,
    title: v.data.title,
    slug: v.data.slug,
    shortDescription: v.data.shortDescription || null,
    priceBuy: v.data.priceBuy || null,
    priceRent: v.data.priceRent || null,
    status: v.data.status || 'draft',
    zipPath,
    zipOriginalName,
  });

  return { created };
}

async function listMyTemplates({ pool, user }) {
  if (!user) throw new Error('AUTH_REQUIRED');

  const ownerUserId = getOwnerUserId(user);
  if (!ownerUserId) throw new Error('USER_ID_MISSING');

  return repo.listByOwner({ pool, ownerUserId });
}

async function getMyTemplateById({ pool, user, id }) {
  if (!user) throw new Error('AUTH_REQUIRED');

  const ownerUserId = getOwnerUserId(user);
  if (!ownerUserId) throw new Error('USER_ID_MISSING');

  return repo.getSellerTemplateForOwnerById({ pool, ownerUserId, id });
}

async function updateMyTemplateStatus({ pool, user, id, status }) {
  if (!user) throw new Error('AUTH_REQUIRED');

  const ownerUserId = getOwnerUserId(user);
  if (!ownerUserId) throw new Error('USER_ID_MISSING');

  const updated = await repo.updateStatusByOwner({ pool, ownerUserId, id, status });
  if (!updated) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { updated };
}

async function deleteMyTemplate({ pool, user, id }) {
  if (!user) throw new Error('AUTH_REQUIRED');

  const ownerUserId = getOwnerUserId(user);
  if (!ownerUserId) throw new Error('USER_ID_MISSING');

  const deleted = await repo.softDeleteByOwner({ pool, ownerUserId, id });
  if (!deleted) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { deleted };
}

module.exports = {
  addSellerTemplate,
  listMyTemplates,
  getMyTemplateById,
  updateMyTemplateStatus,
  deleteMyTemplate,
};
