// src/web/services/templates.service.js
// Catalog templates service (DB-backed)

import { pool } from '../../db/pool.js';

export async function listTemplates() {
  const sql = `
    SELECT
      id,
      slug,
      title,
      short_desc,
      full_desc,
      status,
      demo_url,
      preview_image,
      created_at,
      updated_at
    FROM public.templates
    WHERE status = 'published'
    ORDER BY created_at DESC, id DESC
  `;

  const { rows } = await pool.query(sql);

  // Dev-mapping: пока в БД нет license / is_free / zip_ready,
  // добавляем их здесь, чтобы UI и фильтры работали.
  return rows.map((t) => {
    let license = 'pu';
    if (t.slug === 'seed-minimal-landing') license = 'free';
    if (t.slug === 'seed-portfolio-dark') license = 'cu';

    const is_free = license === 'free';

    let zip_ready = false;
    if (t.slug === 'seed-minimal-landing') zip_ready = true;
    if (t.slug === 'seed-portfolio-dark') zip_ready = true;

    return {
      id: t.id,
      slug: t.slug,
      title: t.title,
      short_desc: t.short_desc,
      full_desc: t.full_desc,
      demo_url: t.demo_url,
      preview_image: t.preview_image,

      // поля, которые ждёт HBS
      license,
      is_free,
      zip_ready,
    };
  });
}
