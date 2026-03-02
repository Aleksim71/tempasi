/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');

const repo = require('./sellerTemplates.repo.cjs');
const zipTool = require('./templateZip.contract.cjs');

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

function throwValidationFailed(details) {
  const err = new Error('VALIDATION_FAILED');
  err.code = 'VALIDATION_FAILED';
  err.details = details;
  throw err;
}

function validatePublishRequirements({ data, zipPath }) {
  // MVP rules for "published":
  // - ZIP is required
  // - At least one of Buy/Rent price must be set AND > 0
  const errors = {};

  const hasZip = Boolean(zipPath);

  const buyCents = repo.toCentsOrNull(data.priceBuy);
  const rentCents = repo.toCentsOrNull(data.priceRent);

  const hasBuy = Number.isFinite(buyCents) && buyCents > 0;
  const hasRent = Number.isFinite(rentCents) && rentCents > 0;

  if (!hasZip) {
    errors.templateZip = 'ZIP file is required to publish.';
  }

  if (!hasBuy && !hasRent) {
    const msg = 'To publish, set Buy and/or Rent price (must be > 0).';
    errors.priceBuy = msg;
    errors.priceRent = msg;
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

function bestEffortUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {
    // ignore
  }
}

function getPreviewPathForTemplateId(templateId) {
  return path.join(process.cwd(), 'public/uploads/previews', `${templateId}.png`);
}

async function validateZipAndWritePreviewOrThrow({ templateId, zipPath }) {
  // validate structure + extract preview to deterministic path
  const outPath = getPreviewPathForTemplateId(templateId);

  await zipTool.validateTemplateZipOrThrowAsync(zipPath);
  await zipTool.extractPreviewPngToFile({ zipPath, outPath });

  return { outPath };
}

function mapZipContractErrorToFormErrors(e) {
  const errors = {};
  if (!e) return errors;

  if (e.code === 'PREVIEW_MISSING') {
    errors.templateZip = 'ZIP must contain preview/preview.png (or preview.png).';
  } else if (e.code === 'INDEX_MISSING') {
    errors.templateZip = 'ZIP must contain index.html (or src/index.html).';
  } else if (e.code === 'PREVIEW_NOT_PNG') {
    errors.templateZip = 'preview.png must be a real PNG file.';
  } else if (e.code === 'UNZIP_LIST_FAILED' || e.code === 'UNZIP_EXTRACT_FAILED') {
    errors.templateZip = 'Cannot read ZIP contents. Upload a valid ZIP.';
  } else if (e.code === 'ZIP_NOT_FOUND') {
    errors.templateZip = 'Uploaded ZIP file not found on disk.';
  }

  return errors;
}

async function addSellerTemplate({ pool, user, body, file }) {
  if (!user) throw new Error('AUTH_REQUIRED');

  const ownerUserId = getOwnerUserId(user);
  if (!ownerUserId) throw new Error('USER_ID_MISSING');

  const v = validateAddOrEditTemplateForm(body);
  if (!v.ok) throwValidationFailed(v);

  const zipPath = file && file.path ? String(file.path) : null;
  const zipOriginalName = file && file.originalname ? String(file.originalname) : null;

  // ZIP is mandatory for add in our MVP UI
  if (!zipPath) {
    const merged = { ...v, ok: false, errors: { ...v.errors, templateZip: 'ZIP file is required.' } };
    throwValidationFailed(merged);
  }

  // Validate zip structure and preview now (so we can show preview in list immediately)
  try {
    await zipTool.validateTemplateZipOrThrowAsync(zipPath);
  } catch (e) {
    const zipErrors = mapZipContractErrorToFormErrors(e);
    const merged = { ...v, ok: false, errors: { ...v.errors, ...zipErrors } };
    throwValidationFailed(merged);
  }

  // If publish requested immediately — enforce publish requirements.
  if (v.data.status === 'published') {
    const pv = validatePublishRequirements({ data: v.data, zipPath });
    if (!pv.ok) {
      const merged = { ...v, ok: false, errors: { ...v.errors, ...pv.errors } };
      throwValidationFailed(merged);
    }
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
    zipPath,
    zipOriginalName,
  });

  // Extract preview to deterministic path: public/uploads/previews/<id>.png
  try {
    await validateZipAndWritePreviewOrThrow({ templateId: created.id, zipPath });
  } catch (e) {
    // If preview extraction fails, keep template but report error next time in Edit
    // (UI will show preview placeholder in list)
  }

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

  const row = await repo.getSellerTemplateForOwnerById({ pool, ownerUserId, id });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Enforce publish requirements server-side
  if (status === 'published') {
    const data = {
      title: row.title,
      slug: row.slug,
      shortDescription: row.short_description || '',
      priceBuy: row.price_buy_cents !== null && row.price_buy_cents !== undefined ? String(row.price_buy_cents / 100) : '',
      priceRent: row.price_rent_cents !== null && row.price_rent_cents !== undefined ? String(row.price_rent_cents / 100) : '',
      status: 'published',
    };

    const pv = validatePublishRequirements({ data, zipPath: row.zip_path });
    if (!pv.ok) {
      const err = new Error('PUBLISH_VALIDATION_FAILED');
      err.code = 'PUBLISH_VALIDATION_FAILED';
      err.details = pv;
      throw err;
    }

    // Also require valid ZIP structure for publish
    try {
      await zipTool.validateTemplateZipOrThrowAsync(row.zip_path);
    } catch (e) {
      const err = new Error('PUBLISH_ZIP_INVALID');
      err.code = 'PUBLISH_ZIP_INVALID';
      err.details = { ...e.details, code: e.code };
      throw err;
    }
  }

  const updated = await repo.updateStatusByOwner({ pool, ownerUserId, id, status });
  if (!updated) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { updated };
}

async function updateSellerTemplate({ pool, user, id, body, file }) {
  if (!user) throw new Error('AUTH_REQUIRED');

  const ownerUserId = getOwnerUserId(user);
  if (!ownerUserId) throw new Error('USER_ID_MISSING');

  const existing = await repo.getSellerTemplateForOwnerById({ pool, ownerUserId, id });
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const v = validateAddOrEditTemplateForm(body);
  if (!v.ok) throwValidationFailed(v);

  // If new zip is provided, validate it and later replace old zip + preview
  const newZipPath = file && file.path ? String(file.path) : undefined;
  const newZipOriginalName = file && file.originalname ? String(file.originalname) : undefined;

  if (newZipPath) {
    try {
      await zipTool.validateTemplateZipOrThrowAsync(newZipPath);
    } catch (e) {
      const zipErrors = mapZipContractErrorToFormErrors(e);
      const merged = { ...v, ok: false, errors: { ...v.errors, ...zipErrors } };
      throwValidationFailed(merged);
    }
  }

  const updated = await repo.updateSellerTemplateByOwner({
    pool,
    ownerUserId,
    id,
    title: v.data.title,
    slug: v.data.slug,
    shortDescription: v.data.shortDescription || null,
    priceBuy: v.data.priceBuy || null,
    priceRent: v.data.priceRent || null,
    zipPath: newZipPath !== undefined ? newZipPath : undefined, // only touch when present
    zipOriginalName: newZipOriginalName !== undefined ? newZipOriginalName : undefined,
  });

  if (!updated) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // If ZIP was replaced:
  if (newZipPath) {
    // delete old ZIP best-effort
    if (existing.zip_path && existing.zip_path !== newZipPath) {
      bestEffortUnlink(existing.zip_path);
    }

    // regenerate preview
    try {
      await validateZipAndWritePreviewOrThrow({ templateId: Number(id), zipPath: newZipPath });
    } catch (e) {
      // Keep updated record but surface error in UI as workspaceError if needed
      const err = new Error(e.code || e.message || 'PREVIEW_EXTRACT_FAILED');
      err.code = e.code || 'PREVIEW_EXTRACT_FAILED';
      err.details = e.details;
      throw err;
    }
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
  updateSellerTemplate,
  deleteMyTemplate,
};
