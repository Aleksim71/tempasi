// src/db/templatesRepo.js
import { pool } from './pool.js';

/* ============================================================
   Список всех шаблонов (/templates)
   - min_price_cents
   - author_email (из users)
   - author_name, author_avatar (из user_profiles)
   ============================================================ */
const getAllTemplatesSql = `
  SELECT
    t.id,
    t.slug,
    t.title,
    t.short_desc,
    t.preview_image,
    t.demo_url,
    COALESCE(MIN(p.price_cents), 0) AS min_price_cents,
    u.email AS author_email,
    up.full_name AS author_name,
    up.avatar_url AS author_avatar
  FROM templates t
  LEFT JOIN template_license_prices p
    ON p.template_id = t.id
  LEFT JOIN users u
    ON u.id = t.author_id
  LEFT JOIN user_profiles up
    ON up.user_id = u.id
  GROUP BY
    t.id,
    t.slug,
    t.title,
    t.short_desc,
    t.preview_image,
    t.demo_url,
    u.email,
    up.full_name,
    up.avatar_url
  ORDER BY t.created_at DESC;
`;

export async function getAllTemplates() {
  const { rows } = await pool.query(getAllTemplatesSql);
  return rows;
}

/* ============================================================
   Детализация одного шаблона (/templates/:slug)
   - категории
   - лицензии + цены
   - author_email, author_name, author_bio, author_avatar
   ============================================================ */
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
    p.price_cents,
    u.email AS author_email,
    up.full_name AS author_name,
    up.bio AS author_bio,
    up.avatar_url AS author_avatar
  FROM templates t
  LEFT JOIN template_categories tc ON tc.template_id = t.id
  LEFT JOIN categories c          ON c.id = tc.category_id
  LEFT JOIN template_license_prices p ON p.template_id = t.id
  LEFT JOIN licenses l            ON l.id = p.license_id
  LEFT JOIN users u               ON u.id = t.author_id
  LEFT JOIN user_profiles up      ON up.user_id = u.id
  WHERE t.slug = $1;
`;

export async function getTemplateBySlug(slug) {
  const { rows } = await pool.query(getTemplateBySlugSql, [slug]);
  if (!rows.length) return null;

  const first = rows[0];

  const categoriesMap = new Map();
  const licensesMap = new Map();

  for (const row of rows) {
    if (row.category_slug && row.category_name && !categoriesMap.has(row.category_slug)) {
      categoriesMap.set(row.category_slug, {
        slug: row.category_slug,
        name: row.category_name,
      });
    }

    if (
      row.license_code &&
      row.license_name &&
      row.price_cents != null &&
      !licensesMap.has(row.license_code)
    ) {
      licensesMap.set(row.license_code, {
        code: row.license_code,
        name: row.license_name,
        price_cents: row.price_cents,
      });
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
    author_email: first.author_email ?? null,
    author_name: first.author_name ?? null,
    author_bio: first.author_bio ?? null,
    author_avatar: first.author_avatar ?? null,
  };
}
