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

  if (!title) errors.title = 'Title is required.';

  const normalizedStatus = status === 'published' ? 'published' : 'draft';

  const buyCents = parseMoneyToCents(priceBuy);
  const rentCents = parseMoneyToCents(priceRent);

  // TEMPASI_REQUIRE_BOTH_PRICES (2026-08-13): Buy and Rent price are
  // now both always required. Previously a seller could pick "Buy
  // only" and skip Rent pricing entirely, or set a Rent price with no
  // sanity check against Buy — e.g. renting for 1 day costing as much
  // as buying outright, which quietly kills the point of renting that
  // template. Requiring both up front doesn't fully prevent bad
  // pricing, but removes the easiest way to end up with a template
  // that has no real rent option at all.
  if (!priceBuy) {
    errors.priceBuy = 'Buy price is required.';
  } else if (buyCents === null) {
    errors.priceBuy = 'Enter a valid buy price.';
  } else if (buyCents <= 0) {
    errors.priceBuy = 'Buy price must be greater than 0.';
  }

  if (!priceRent) {
    errors.priceRent = 'Rent price is required.';
  } else if (rentCents === null) {
    errors.priceRent = 'Enter a valid rent price.';
  } else if (rentCents <= 0) {
    errors.priceRent = 'Rent price must be greater than 0.';
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
      priceRent,
      status: normalizedStatus,
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
  // - Buy AND Rent price must both be set AND > 0 (TEMPASI_REQUIRE_BOTH_PRICES,
  //   2026-08-13 — was "at least one of Buy/Rent"; matches the same
  //   always-required rule now enforced in validateAddOrEditTemplateForm().
  //   This function is the separate path used by the List view's
  //   Publish toggle, which doesn't go through the Add/Edit form, so it
  //   needs the same rule applied independently. Note: an existing
  //   published legacy "Buy only" template that gets unpublished and
  //   re-published will now be blocked until a Rent price is added —
  //   intended consequence of the rule, not a bug.)
  const errors = {};

  const hasZip = Boolean(zipPath);

  const buyCents = repo.toCentsOrNull(data.priceBuy);
  const rentCents = repo.toCentsOrNull(data.priceRent);

  const hasBuy = Number.isFinite(buyCents) && buyCents > 0;
  const hasRent = Number.isFinite(rentCents) && rentCents > 0;

  if (!hasZip) {
    errors.templateZip = 'ZIP file is required to publish.';
  }

  if (!hasBuy) {
    errors.priceBuy = 'Buy price is required to publish (must be > 0).';
  }

  if (!hasRent) {
    errors.priceRent = 'Rent price is required to publish (must be > 0).';
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

  // TEMPASI_ADD_TEMPLATE_LIVE_CATEGORY_FIX (2026-08-12)
  // normalizeTemplateCategory() (used above, inside
  // validateAddOrEditTemplateForm) only recognizes the original 11
  // hardcoded category slugs — documented known debt in PILGRIM.md.
  // Any category added later via admin (e.g. saas-tech-startups,
  // corporate-business, healthcare-wellness, ...) silently fell back
  // to 'other' on create, even though edit already handles this
  // correctly via its own live catalog_categories lookup. Deliberately
  // NOT touching the hardcoded set/function itself (kept as a safety
  // net for garbage input) — just re-checking the raw submitted value
  // against the live table and using it when valid, same source of
  // truth the edit path already trusts.
  try {
    const rawCategory = String(body?.category || '').trim().toLowerCase();
    if (rawCategory && rawCategory !== v.data.category) {
      const { rows } = await pool.query('SELECT slug FROM catalog_categories WHERE slug = $1 LIMIT 1', [
        rawCategory,
      ]);
      if (rows[0]) {
        v.data.category = rawCategory;
      }
    }
  } catch (_e) {
    // best-effort; fall back to whatever normalizeTemplateCategory already produced
  }

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

  // TEMPASI_SLUG_COLLISION_RETRY_FIX (2026-08-12)
  // buildUniqueSellerTemplateSlug() checks for a free slug via a plain
  // SELECT, then this INSERT commits it — two near-simultaneous
  // submissions (e.g. an accidental double-click on Add, or a quick
  // resubmit) can both pass that SELECT check before either INSERT
  // commits, so the second genuinely collides on the DB's unique
  // constraint and repo.insertSellerTemplate() throws
  // SLUG_ALREADY_EXISTS. Previously this always fell through to a
  // generic, unhelpful top-of-page error banner (the route's catch
  // block only recognised the differently-named SLUG_TAKEN error that
  // updateSellerTemplate/edit throws for the same kind of conflict).
  // Since this is purely a timing race, not a real naming conflict the
  // user needs to resolve, just regenerate a fresh slug and retry a
  // few times — transparent to the user in the overwhelmingly common
  // case, with a proper (not generic) error message as a fallback if
  // every retry somehow still collides.
  let created;
  let lastSlugError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slugForAttempt =
      attempt === 0 ? generatedSlug : await buildUniqueSellerTemplateSlug({ pool, title: v.data.title });
    try {
      created = await repo.insertSellerTemplate({
        pool,
        ownerUserId,
        title: v.data.title,
        slug: slugForAttempt,
        shortDescription: v.data.shortDescription || null,
        category: v.data.category || 'other',
        tags: v.data.tags || '',
        priceBuy: v.data.priceBuy || null,
        priceRent: v.data.priceRent || null,
        status: v.data.status || 'draft',
        zipPath,
        zipOriginalName,
      });
      lastSlugError = null;
      break;
    } catch (e) {
      if (e && (e.code === 'SLUG_ALREADY_EXISTS' || e.message === 'SLUG_ALREADY_EXISTS')) {
        lastSlugError = e;
        continue;
      }
      throw e;
    }
  }
  if (lastSlugError) throw lastSlugError;

  // Extract preview to canonical storage path: <TEMPLATE_UPLOAD_DIR>/<slug>/preview/preview.png
  try {
    await validateZipAndWritePreviewOrThrow({ slug: created.slug || generatedSlug, zipPath });
  } catch (e) {
    // If preview extraction fails, keep template but report error next time in Edit
    // (UI will show preview placeholder in list)
  }

  // TEMPASI_FULL_EXTRACT_ON_UPLOAD (2026-08-04)
  // Extract the full ZIP (src/index.html, assets, etc.) to
  // <TEMPLATE_UPLOAD_DIR>/<slug>/ so Live Demo and post-purchase
  // download work immediately after upload — no separate manual
  // ingest step anymore. Best-effort like the preview extraction
  // above: if the ZIP doesn't meet the fuller structure requirement
  // (e.g. no src/index.html), the listing itself still succeeds —
  // Live Demo just won't have anything to show until re-uploaded.
  try {
    await zipTool.extractFullTemplateToUploadDir({
      zipPath,
      slug: created.slug || generatedSlug,
      destRoot: getTemplateUploadRoot(),
    });
  } catch (e) {
    // best-effort — see comment above
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

    // TEMPASI_FULL_EXTRACT_ON_UPLOAD (2026-08-04) — see addSellerTemplate
    // for the full rationale. Best-effort: doesn't block the update.
    try {
      await zipTool.extractFullTemplateToUploadDir({
        zipPath: newZipPath,
        slug: updated.slug || generatedSlug || existing.slug,
        destRoot: getTemplateUploadRoot(),
      });
    } catch (e) {
      // best-effort — see comment above
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

async function adminDeleteTemplate({ pool, id }) {
  const deleted = await repo.adminSoftDelete({ pool, id });
  if (!deleted) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { deleted };
}

const ADMIN_TRASH_PAGE_SIZE = 25;

async function adminListTrash({ pool, page }) {
  const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const limit = ADMIN_TRASH_PAGE_SIZE;
  const offset = (safePage - 1) * limit;

  const [items, total] = await Promise.all([
    repo.adminListTrash({ pool, limit, offset }),
    repo.adminCountTrash({ pool }),
  ]);

  return { items, total, page: safePage, pageSize: limit };
}

async function adminRestoreTemplate({ pool, id }) {
  const restored = await repo.adminRestore({ pool, id });
  if (!restored) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { restored };
}

// "Delete forever" — real DB row removal + best-effort file cleanup.
// File cleanup NEVER blocks or fails the DB deletion: the upload dir
// can be a network mount (e.g. sshfs to a separate machine acting as
// file server) that may be temporarily unreachable, and the admin
// still needs to be able to permanently clear trash regardless of
// that mount's availability. Same non-throwing bestEffortUnlink
// helper already used elsewhere in this file when a ZIP gets
// replaced on update.
async function adminPurgeTemplate({ pool, id }) {
  const deleted = await repo.adminHardDelete({ pool, id });
  if (!deleted) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  bestEffortUnlink(deleted.zip_path);

  try {
    bestEffortUnlink(getPreviewPathForTemplateSlug(deleted.slug));
  } catch (_) {
    // getPreviewPathForTemplateSlug only throws on an empty slug;
    // nothing to clean up in that case.
  }

  return { deleted };
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
  adminDeleteTemplate,
  adminListTrash,
  adminRestoreTemplate,
  adminPurgeTemplate,
};
