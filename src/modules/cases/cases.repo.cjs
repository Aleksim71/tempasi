'use strict';

// src/modules/cases/cases.repo.cjs

let getPool;
try {
  ({ getPool } = require('../../../scripts/db.pool.cjs'));
} catch (_e1) {
  try {
    ({ getPool } = require('../../scripts/db.pool.cjs'));
  } catch (e2) {
    throw e2;
  }
}

function pickDb(db) {
  return db && typeof db.query === 'function' ? db : getPool();
}

async function getTableColumns(pool, tableName) {
  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );

  return new Set((rows || []).map((row) => row.column_name));
}

async function getCasesSchema(pool) {
  const caseColumns = await getTableColumns(pool, 'cases');
  const caseTemplateColumns = await getTableColumns(pool, 'case_templates');

  const ownerColumn = caseColumns.has('owner_user_id') ? 'owner_user_id' : 'user_id';
  const noteColumn = caseColumns.has('note') ? 'note' : caseColumns.has('notes') ? 'notes' : null;
  const hasClientName = caseColumns.has('client_name');
  const hasCaseTemplatePosition = caseTemplateColumns.has('position');

  return {
    ownerColumn,
    noteColumn,
    hasClientName,
    hasCaseTemplatePosition,
  };
}

function ownerValueForSchema(ownerUserId, schema) {
  if (schema.ownerColumn === 'user_id') return String(ownerUserId);
  return ownerUserId;
}

async function listByOwner(ownerUserId, db) {
  const pool = pickDb(db);
  const schema = await getCasesSchema(pool);
  const ownerValue = ownerValueForSchema(ownerUserId, schema);

  const clientNameSelect = schema.hasClientName ? 'c.client_name' : 'NULL::text AS client_name';
  const templatesCountJoin = `
    LEFT JOIN case_templates ct ON ct.case_id = c.id
  `;

  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.title,
      ${clientNameSelect},
      c.created_at,
      c.updated_at,
      COUNT(ct.template_id)::int AS templates_count
    FROM cases c
    ${templatesCountJoin}
    WHERE c.${schema.ownerColumn} = $1
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    `,
    [ownerValue]
  );

  return rows;
}

async function countByOwner(ownerUserId, db) {
  const pool = pickDb(db);
  const schema = await getCasesSchema(pool);
  const ownerValue = ownerValueForSchema(ownerUserId, schema);

  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM cases
    WHERE ${schema.ownerColumn} = $1
    `,
    [ownerValue]
  );

  return Number(rows?.[0]?.count || 0);
}

async function listOwnedCaseIds(ownerUserId, caseIds, db) {
  const pool = pickDb(db);
  const schema = await getCasesSchema(pool);
  const ownerValue = ownerValueForSchema(ownerUserId, schema);
  const normalized = Array.isArray(caseIds)
    ? [...new Set(caseIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];

  if (normalized.length === 0) return [];

  const { rows } = await pool.query(
    `
    SELECT id::text AS id
    FROM cases
    WHERE ${schema.ownerColumn} = $1
      AND id::text = ANY($2::text[])
    ORDER BY updated_at DESC
    `,
    [ownerValue, normalized]
  );

  return (rows || []).map((row) => String(row.id));
}

async function createCase({ ownerUserId, title, clientName, note }, db) {
  const pool = pickDb(db);
  const schema = await getCasesSchema(pool);
  const ownerValue = ownerValueForSchema(ownerUserId, schema);

  const columns = [schema.ownerColumn, 'title'];
  const values = [ownerValue, title];
  const placeholders = ['$1', '$2'];

  if (schema.hasClientName) {
    columns.push('client_name');
    values.push(clientName || null);
    placeholders.push(`$${values.length}`);
  }

  if (schema.noteColumn) {
    columns.push(schema.noteColumn);
    values.push(note || null);
    placeholders.push(`$${values.length}`);
  }

  const { rows } = await pool.query(
    `
    INSERT INTO cases (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
    `,
    values
  );

  return rows[0];
}

async function ensureDefaultCase(ownerUserId, db) {
  const existingCount = await countByOwner(ownerUserId, db);
  if (existingCount > 0) return null;

  return createCase(
    {
      ownerUserId,
      title: 'My first client case',
      clientName: null,
      note: 'Created automatically during registration.',
    },
    db
  );
}

async function deleteOwnedCase({ ownerUserId, caseId }, db) {
  const pool = pickDb(db);
  const schema = await getCasesSchema(pool);
  const ownerValue = ownerValueForSchema(ownerUserId, schema);
  const count = await countByOwner(ownerUserId, pool);

  if (count <= 1) {
    const err = new Error(
      'You need at least one case to use Tempasi. Create another case before deleting this one.'
    );
    err.code = 'LAST_CASE_DELETE_BLOCKED';
    throw err;
  }

  const { rows } = await pool.query(
    `
    DELETE FROM cases
    WHERE id = $1 AND ${schema.ownerColumn} = $2
    RETURNING *
    `,
    [caseId, ownerValue]
  );

  return rows[0] || null;
}

async function addTemplate(caseId, templateId, db) {
  const pool = pickDb(db);
  const schema = await getCasesSchema(pool);

  if (schema.hasCaseTemplatePosition) {
    await pool.query(
      `
      INSERT INTO case_templates(case_id, template_id, position)
      VALUES ($1, $2, 0)
      ON CONFLICT (case_id, template_id) DO NOTHING
      `,
      [caseId, String(templateId)]
    );
    return;
  }

  await pool.query(
    `
    INSERT INTO case_templates(case_id, template_id)
    VALUES ($1, $2)
    ON CONFLICT (case_id, template_id) DO NOTHING
    `,
    [caseId, templateId]
  );
}

async function removeTemplate(caseId, templateId, db) {
  const pool = pickDb(db);
  await pool.query(
    `
    DELETE FROM case_templates
    WHERE case_id = $1 AND template_id = $2
    `,
    [caseId, String(templateId)]
  );
}

async function getOwnedCaseById({ ownerUserId, caseId }, db) {
  const pool = pickDb(db);
  const schema = await getCasesSchema(pool);
  const ownerValue = ownerValueForSchema(ownerUserId, schema);

  const clientNameSelect = schema.hasClientName ? 'c.client_name' : 'NULL::text AS client_name';
  const noteSelect = schema.noteColumn ? `c.${schema.noteColumn} AS note` : 'NULL::text AS note';

  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.title,
      ${clientNameSelect},
      ${noteSelect},
      c.created_at,
      c.updated_at
    FROM cases c
    WHERE c.${schema.ownerColumn} = $1
      AND c.id::text = $2::text
    LIMIT 1
    `,
    [ownerValue, String(caseId)]
  );

  return rows[0] || null;
}

async function listCaseTemplates({ ownerUserId, caseId }, db) {
  const pool = pickDb(db);
  const ownedCase = await getOwnedCaseById({ ownerUserId, caseId }, pool);
  if (!ownedCase) return [];

  const { rows } = await pool.query(
    `
    SELECT
      o.id AS order_id,
      o.template_slug,
      o.deal_type,
      o.status AS order_status,
      e.id AS entitlement_id,
      e.starts_at,
      e.ends_at,
      COALESCE(st.id::text, o.template_slug) AS template_id,
      COALESCE(st.title, o.template_slug) AS title,
      COALESCE(st.short_description, '') AS short_description,
      COALESCE(st.category, 'other') AS category,
      COALESCE(st.tags::text, '') AS tags,
      COUNT(oca_all.case_id)::int AS cases_count
    FROM public.order_case_assignments oca
    JOIN public.orders o
      ON o.id = oca.order_id
    JOIN public.entitlements e
      ON e.order_id = o.id
    LEFT JOIN public.seller_templates st
      ON st.slug = o.template_slug
    LEFT JOIN public.order_case_assignments oca_all
      ON oca_all.order_id = o.id
    WHERE oca.case_id::text = $2::text
      AND o.user_id::text = $1::text
      AND UPPER(COALESCE(o.deal_type, e.deal_type, e.kind, '')) = 'RENT'
      AND LOWER(COALESCE(o.status, '')) = 'paid'
      AND e.closed_at IS NULL
      AND (e.ends_at IS NULL OR e.ends_at > NOW())
    GROUP BY o.id, e.id, st.id, st.title, st.short_description, st.category, st.tags
    ORDER BY e.ends_at ASC NULLS LAST, o.created_at DESC, o.id DESC
    `,
    [String(ownerUserId), String(caseId)]
  );

  return rows || [];
}

async function listAvailableCasesForOrder({ ownerUserId, orderId }, db) {
  const pool = pickDb(db);
  const schema = await getCasesSchema(pool);
  const ownerValue = ownerValueForSchema(ownerUserId, schema);

  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.title
    FROM cases c
    WHERE c.${schema.ownerColumn} = $1
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_case_assignments oca
        WHERE oca.order_id = $2
          AND oca.case_id::text = c.id::text
      )
    ORDER BY c.updated_at DESC, c.created_at DESC
    `,
    [ownerValue, Number(orderId)]
  );

  return rows || [];
}

async function clearOwnedCaseAssignments({ ownerUserId, caseId }, db) {
  const pool = pickDb(db);
  const ownedCase = await getOwnedCaseById({ ownerUserId, caseId }, pool);
  if (!ownedCase) return { deletedCount: 0, keptCount: 0 };

  const deleted = await pool.query(
    `
    DELETE FROM public.order_case_assignments oca
    WHERE oca.case_id::text = $1::text
      AND EXISTS (
        SELECT 1
        FROM public.order_case_assignments other_oca
        WHERE other_oca.order_id = oca.order_id
          AND other_oca.case_id::text <> $1::text
      )
    RETURNING *
    `,
    [String(caseId)]
  );

  const remaining = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM public.order_case_assignments
    WHERE case_id::text = $1::text
    `,
    [String(caseId)]
  );

  return {
    deletedCount: Number(deleted.rowCount || 0),
    keptCount: Number(remaining.rows?.[0]?.count || 0),
  };
}


module.exports = {
  listByOwner,
  countByOwner,
  listOwnedCaseIds,
  getOwnedCaseById,
  listCaseTemplates,
  listAvailableCasesForOrder,
  clearOwnedCaseAssignments,
  createCase,
  ensureDefaultCase,
  deleteOwnedCase,
  addTemplate,
  removeTemplate,
};
