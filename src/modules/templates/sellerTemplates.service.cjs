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


function slugifyTemplateTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'template';
}

async function buildUniqueSellerTemplateSlug({ pool, title, excludeId = null }) {
  const base = slugifyTemplateTitle(title);
  let candidate = base;

  for (let i = 0; i < 100; i += 1) {
    const result = await pool.query(
      `
        SELECT id
        FROM seller_templates
        WHERE slug = $1
          AND deleted_at IS NULL
          ${excludeId ? 'AND id <> $2' : ''}
        LIMIT 1
      `,
      excludeId ? [candidate, excludeId] : [candidate],
    );

    if (result.rowCount === 0) return candidate;

    candidate = `${base}-${i + 2}`;
  }

  return `${base}-${Date.now()}`;
}

function normalizeTemplateLicense(value) {
  const license = String(value || '').trim();

  if (license === 'buy_only' || license === 'buy_rent') {
    return license;
  }

  return '';
}



function parseMoneyToCents(value) {
  const raw = String(value ?? '').trim();

  if (!raw) return null;

  const normalized = raw.replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [eurosRaw, centsRaw = ''] = normalized.split('.');
  const euros = Number(eurosRaw);
  const cents = Number((centsRaw + '00').slice(0, 2));

  if (!Number.isSafeInteger(euros) || !Number.isSafeInteger(cents)) {
    return null;
  }

  const total = euros * 100 + cents;

  return Number.isSafeInteger(total) ? total : null;
}


const TEMPLATE_CATEGORY_VALUES = new Set([
  'landing',
  'ecommerce',
  'blog',
  'portfolio',
  'saas',
  'restaurant',
  'real-estate',
  'education',
  'events',
  'health',
  'other',
]);

function normalizeTemplateCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  return TEMPLATE_CATEGORY_VALUES.has(raw) ? raw : 'other';
}

function normalizeTemplateTags(value) {
  const raw = String(value || '').trim();

  if (!raw) return '';

  const seen = new Set();
  const tags = raw
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .map((tag) => tag.replace(/\s+/g, ' '))
    .filter((tag) => tag.length <= 30)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 15);

  return tags.join(', ');
}

function validateAddOrEditTemplateForm(body = {}) {
  const errors = {};

  const title = String(body?.title || '').trim();
  const shortDescription = String(body?.shortDescription || '').trim();
  const category = normalizeTemplateCategory(body?.category || 'other');
  const tags = normalizeTemplateTags(body?.tags || '');
  const priceBuy = String(body?.priceBuy || '').trim();
  const priceRent = String(body?.priceRent || '').trim();
  const status = String(body?.status || 'draft').trim();

  // User-facing field. This is NOT a legal license.
  // Internal legacy compatibility:
  // - buy_only -> BUY
  // - buy_rent -> BUY_RENT
  const sellingOption = String(body?.sellingOption || body?.license || 'buy_rent').trim();

  const allowedSellingOptions = new Set(['buy_only', 'buy_rent']);

  if (!title) errors.title = 'Title is required.';

  if (!allowedSellingOptions.has(sellingOption)) {
    errors.sellingOption = 'Choose a selling option.';
  }

  const normalizedStatus = status === 'published' ? 'published' : 'draft';

  const buyCents = parseMoneyToCents(priceBuy);
  const rentCents = parseMoneyToCents(priceRent);

  if (priceBuy && buyCents === null) {
    errors.priceBuy = 'Enter a valid buy price.';
  }

  if (priceRent && rentCents === null) {
    errors.priceRent = 'Enter a valid rent price.';
  }

  if (sellingOption === 'buy_only' && priceRent) {
    errors.priceRent = 'Rent price is only allowed for Buy + Rent templates.';
  }

  if (sellingOption === 'buy_rent' && !priceRent) {
    errors.priceRent = 'Rent price is required for Buy + Rent templates.';
  }

  if (normalizedStatus === 'published' && !priceBuy) {
    errors.priceBuy = 'Buy price is required before publishing.';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: {
      title,
      shortDescription,
      category,
      tags,
      // Keep raw form values here.
      // Repository is the single place that converts EUR strings to cents.
      // Do NOT pass buyCents/rentCents here, otherwise prices are multiplied by 100 twice.
      priceBuy,
      priceRent: sellingOption === 'buy_rent' ? priceRent : null,
      status: normalizedStatus,
      sellingOption,
      internalLicense: sellingOption === 'buy_rent' ? 'BUY_RENT' : 'BUY',
    },
  };
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

function getTemplateUploadRoot() {
  return path.resolve(
    process.env.TEMPLATE_UPLOAD_DIR ||
    process.env.UPLOAD_DIR ||
    path.join(process.cwd(), 'uploads', 'templates')
  );
}

function getPreviewPathForTemplateSlug(slug) {
  const safeSlug = String(slug || '').trim();

  if (!safeSlug) {
    const err = new Error('TEMPLATE_PREVIEW_SLUG_REQUIRED');
    err.code = 'TEMPLATE_PREVIEW_SLUG_REQUIRED';
    throw err;
  }

  return path.join(getTemplateUploadRoot(), safeSlug, 'preview', 'preview.png');
}

async function validateZipAndWritePreviewOrThrow({ slug, zipPath }) {
  const outPath = getPreviewPathForTemplateSlug(slug);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

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

  const generatedSlug = await buildUniqueSellerTemplateSlug({
    pool,
    title: v.data.title,
  });

  const created = await repo.insertSellerTemplate({
    pool,
    ownerUserId,
    title: v.data.title,
    slug: generatedSlug,
    shortDescription: v.data.shortDescription || null,
    category: v.data.category || 'other',
    tags: v.data.tags || '',
    category: v.data.category || 'other',
    tags: v.data.tags || '',
    priceBuy: v.data.priceBuy || null,
    priceRent: v.data.priceRent || null,
    status: v.data.status || 'draft',
    license: v.data.internalLicense,
zipPath,
    zipOriginalName,
  });

  // Extract preview to canonical storage path: <TEMPLATE_UPLOAD_DIR>/<slug>/preview/preview.png
  try {
    await validateZipAndWritePreviewOrThrow({ slug: created.slug || generatedSlug, zipPath });
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

  // Admin block takes precedence over the seller's own publish action.
  // The repo-level WHERE guard is the real safety net (race-safe); this
  // check just gives a clear error code instead of a silent no-op.
  if (status === 'published' && row.admin_blocked_at) {
    const err = new Error('TEMPLATE_BLOCKED_BY_ADMIN');
    err.code = 'TEMPLATE_BLOCKED_BY_ADMIN';
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

  const nextStatus = v.data.status || 'draft';
  if (nextStatus === 'published' && existing.admin_blocked_at) {
    const err = new Error('TEMPLATE_BLOCKED_BY_ADMIN');
    err.code = 'TEMPLATE_BLOCKED_BY_ADMIN';
    throw err;
  }

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

  const generatedSlug = await buildUniqueSellerTemplateSlug({
    pool,
    title: v.data.title,
    excludeId: id,
  });

  const updated = await repo.updateSellerTemplateByOwner({
    pool,
    ownerUserId,
    id,
    title: v.data.title,
    slug: existing.slug,
    shortDescription: v.data.shortDescription || null,
    category: v.data.category || 'other',
    tags: v.data.tags || '',
    priceBuy: v.data.priceBuy || null,
    priceRent: v.data.priceRent || null,
    status: v.data.status || 'draft',
    zipPath: newZipPath !== undefined ? newZipPath : undefined, // only touch when present
    zipOriginalName: newZipOriginalName !== undefined ? newZipOriginalName : undefined,
  });

  if (!updated) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // TEMPASI_SAVE_CATEGORY_TAGS_ON_EDIT
  // Persist catalog metadata from Add/Edit form.
  // Category/tags are catalog fields, not technical upload fields.
  await pool.query(
    `
      UPDATE seller_templates
      SET
        category = $1,
        tags = $2,
        updated_at = NOW()
      WHERE id = $3
        AND owner_user_id = $4
        AND deleted_at IS NULL
    `,
    [
      v.data.category || 'other',
      v.data.tags || '',
      id,
      ownerUserId,
    ],
  );

  // If ZIP was replaced:
  if (newZipPath) {
    // delete old ZIP best-effort
    if (existing.zip_path && existing.zip_path !== newZipPath) {
      bestEffortUnlink(existing.zip_path);
    }

    // regenerate preview
    try {
      await validateZipAndWritePreviewOrThrow({ slug: updated.slug || generatedSlug || existing.slug, zipPath: newZipPath });
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

// ------------------------------------------------------------
// ADMIN block/unblock (not owner-scoped). Callers (admin routes) are
// responsible for writing the admin_audit_log entry — this function
// only performs the actual mutation via the module's own repo.
// ------------------------------------------------------------
async function adminBlockTemplate({ pool, id }) {
  const updated = await repo.adminSetBlocked({ pool, id, blocked: true });
  if (!updated) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { updated };
}

async function adminUnblockTemplate({ pool, id }) {
  const updated = await repo.adminSetBlocked({ pool, id, blocked: false });
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
  updateSellerTemplate,
  deleteMyTemplate,

  // admin-only (not owner-scoped)
  adminBlockTemplate,
  adminUnblockTemplate,
};
