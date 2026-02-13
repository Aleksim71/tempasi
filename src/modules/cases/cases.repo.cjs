'use strict';

// src/modules/cases/cases.repo.cjs
// Minimal repository for "Cases" (client shortlists).
//
// IMPORTANT:
// - user_id in cases table is TEXT (supports numeric/string/uuid ids).
//
// Expected DB interface:
// - `db.query(sql, params)` compatible with pg Pool/Client.

function assertDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('CASES_REPO_DB_REQUIRED: db with query(sql, params) is required');
  }
}

function normUserId(userId) {
  if (userId === null || userId === undefined) return null;
  const v = String(userId).trim();
  return v ? v : null;
}

async function listCasesByUser(db, userId, { limit = 20, offset = 0 } = {}) {
  assertDb(db);
  const uid = normUserId(userId);
  if (!uid) return [];

  const sql = `
    SELECT
      c.id,
      c.title,
      c.notes,
      c.created_at,
      c.updated_at,
      COALESCE(ct.count_templates, 0) AS templates_count
    FROM cases c
    LEFT JOIN (
      SELECT case_id, COUNT(*)::int AS count_templates
      FROM case_templates
      GROUP BY case_id
    ) ct ON ct.case_id = c.id
    WHERE c.user_id = $1
    ORDER BY c.updated_at DESC, c.created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const { rows } = await db.query(sql, [uid, limit, offset]);
  return rows;
}

async function createCase(db, userId, { title, notes = null }) {
  assertDb(db);
  const uid = normUserId(userId);
  if (!uid) throw new Error('CASES_REPO_USER_REQUIRED');

  const sql = `
    INSERT INTO cases (user_id, title, notes)
    VALUES ($1, $2, $3)
    RETURNING id, user_id, title, notes, created_at, updated_at
  `;
  const { rows } = await db.query(sql, [uid, String(title || '').trim(), notes]);
  return rows[0] || null;
}

async function getCaseByIdForUser(db, userId, caseId) {
  assertDb(db);
  const uid = normUserId(userId);
  if (!uid) return null;

  const sql = `
    SELECT id, user_id, title, notes, created_at, updated_at
    FROM cases
    WHERE id = $1 AND user_id = $2
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [caseId, uid]);
  return rows[0] || null;
}

async function updateCase(db, userId, caseId, { title, notes }) {
  assertDb(db);
  const uid = normUserId(userId);
  if (!uid) return null;

  const sql = `
    UPDATE cases
    SET
      title = COALESCE($3, title),
      notes = $4
    WHERE id = $1 AND user_id = $2
    RETURNING id, user_id, title, notes, created_at, updated_at
  `;
  const t = title == null ? null : String(title).trim();
  const { rows } = await db.query(sql, [caseId, uid, t, notes ?? null]);
  return rows[0] || null;
}

async function listCaseTemplates(db, userId, caseId) {
  assertDb(db);
  const uid = normUserId(userId);
  if (!uid) return [];

  // Ensures ownership by joining with cases.
  const sql = `
    SELECT
      ct.template_id,
      ct.position,
      ct.created_at
    FROM case_templates ct
    INNER JOIN cases c ON c.id = ct.case_id
    WHERE ct.case_id = $1 AND c.user_id = $2
    ORDER BY ct.position ASC, ct.created_at ASC
  `;
  const { rows } = await db.query(sql, [caseId, uid]);
  return rows;
}

async function addTemplateToCase(db, userId, caseId, templateId) {
  assertDb(db);
  const uid = normUserId(userId);
  if (!uid) return { ok: false, reason: 'UNAUTH' };

  // Verify case ownership
  const owned = await getCaseByIdForUser(db, uid, caseId);
  if (!owned) return { ok: false, reason: 'NOT_FOUND' };

  // Next position = max(position)+1
  const posRes = await db.query(
    `SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM case_templates WHERE case_id = $1`,
    [caseId],
  );
  const nextPos = (posRes.rows[0]?.max_pos ?? -1) + 1;

  const sql = `
    INSERT INTO case_templates (case_id, template_id, position)
    VALUES ($1, $2, $3)
    ON CONFLICT (case_id, template_id)
    DO UPDATE SET position = EXCLUDED.position
    RETURNING case_id, template_id, position, created_at
  `;
  const { rows } = await db.query(sql, [caseId, String(templateId), nextPos]);
  return { ok: true, item: rows[0] };
}

async function removeTemplateFromCase(db, userId, caseId, templateId) {
  assertDb(db);
  const uid = normUserId(userId);
  if (!uid) return { ok: false, reason: 'UNAUTH' };

  // Ownership check via join
  const sql = `
    DELETE FROM case_templates ct
    USING cases c
    WHERE ct.case_id = $1
      AND ct.template_id = $2
      AND c.id = ct.case_id
      AND c.user_id = $3
  `;
  await db.query(sql, [caseId, String(templateId), uid]);
  return { ok: true };
}

module.exports = {
  listCasesByUser,
  createCase,
  getCaseByIdForUser,
  updateCase,
  listCaseTemplates,
  addTemplateToCase,
  removeTemplateFromCase,
};
