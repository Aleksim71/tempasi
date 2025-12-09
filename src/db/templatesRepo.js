// src/db/templatesRepo.js
import { pool } from './pool.js';

const getAllTemplatesSql = `
  SELECT
    t.id,
    t.slug,
    t.title,
    t.short_desc,
    t.preview_image,
    t.demo_url,
    COALESCE(MIN(p.price_cents), 0) AS min_price_cents
  FROM templates t
  LEFT JOIN template_license_prices p
    ON p.template_id = t.id
  GROUP BY
    t.id,
    t.slug,
    t.title,
    t.short_desc,
    t.preview_image,
    t.demo_url
  ORDER BY t.created_at DESC;
`;

export async function getAllTemplates() {
  const { rows } = await pool.query(getAllTemplatesSql);
  return rows;
}

const getTemplateBySlugSql = `
  SELECT
    t.id,
    t.slug,
    t.title,
    t.short_desc,
    t.full_desc,
    t.preview_image,
    t.demo_url,
    t.created_at,
    c.slug  AS category_slug,
    c.name  AS category_name,
    l.code  AS license_code,
    l.name  AS license_name,
    p.price_cents
  FROM templates t
  LEFT JOIN template_categories tc
    ON tc.template_id = t.id
  LEFT JOIN categories c
    ON c.id = tc.category_id
  LEFT JOIN template_license_prices p
    ON p.template_id = t.id
  LEFT JOIN licenses l
    ON l.id = p.license_id
  WHERE t.slug = $1;
`;

export async function getTemplateBySlug(slug) {
  const { rows } = await pool.query(getTemplateBySlugSql, [slug]);

  if (!rows.length) return null;

  const first = rows[0];

  const categoriesMap = new Map();
  const licensesMap = new Map();

  for (const row of rows) {
    if (row.category_slug && row.category_name) {
      if (!categoriesMap.has(row.category_slug)) {
        categoriesMap.set(row.category_slug, {
          slug: row.category_slug,
          name: row.category_name,
        });
      }
    }

    if (row.license_code && row.license_name && row.price_cents != null) {
      if (!licensesMap.has(row.license_code)) {
        licensesMap.set(row.license_code, {
          code: row.license_code,
          name: row.license_name,
          price_cents: row.price_cents,
        });
      }
    }
  }

  return {
    id: first.id,
    slug: first.slug,
    title: first.title,
    short_desc: first.short_desc,
    full_desc: first.full_desc,
    preview_image: first.preview_image,
    demo_url: first.demo_url,
    created_at: first.created_at,
    categories: Array.from(categoriesMap.values()),
    licenses: Array.from(licensesMap.values()),
  };
}
