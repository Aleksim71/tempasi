'use strict';

const { getPool } = require('../../scripts/db.pool.cjs');

async function listByOwner(ownerUserId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.title,
      c.client_name,
      c.created_at,
      c.updated_at,
      COUNT(ct.template_id)::int AS templates_count
    FROM cases c
    LEFT JOIN case_templates ct ON ct.case_id = c.id
    WHERE c.owner_user_id = $1
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    `,
    [ownerUserId]
  );
  return rows;
}

async function createCase({ ownerUserId, title, clientName, note }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    INSERT INTO cases (owner_user_id, title, client_name, note)
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [ownerUserId, title, clientName || null, note || null]
  );
  return rows[0];
}

async function addTemplate(caseId, templateId) {
  const pool = getPool();
  await pool.query(
    `
    INSERT INTO case_templates(case_id, template_id)
    VALUES ($1, $2)
    ON CONFLICT (case_id, template_id) DO NOTHING
    `,
    [caseId, templateId]
  );
}

async function removeTemplate(caseId, templateId) {
  const pool = getPool();
  await pool.query(
    `
    DELETE FROM case_templates
    WHERE case_id = $1 AND template_id = $2
    `,
    [caseId, templateId]
  );
}

module.exports = {
  listByOwner,
  createCase,
  addTemplate,
  removeTemplate,
};
