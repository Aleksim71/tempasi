// tests/templateDetailsStoredPreview.integration.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgAAAAABJRU5ErkJggg==',
    'base64',
  );
}

function extractPreviewImgSrc(html) {
  const imgs = [...html.matchAll(/<img\b[\s\S]*?>/gi)].map((m) => m[0]);

  const preview = imgs.find((tag) =>
    /\bclass="[^"]*\btemplate-preview-image\b[^"]*"/i.test(tag) ||
    /\balt="[^"]*preview[^"]*"/i.test(tag)
  );

  if (!preview) return '';

  const src = preview.match(/\bsrc="([^"]+)"/i);
  return src ? src[1] : '';
}

describe('template details stored preview integration', () => {
  let db;
  let app;
  const slug = 'details-preview-contract';

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL_TEST;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL_TEST is required');
    }

    const storageRoot = process.env.TEMPLATE_UPLOAD_DIR || path.join(ROOT, 'uploads', 'templates');

    db = new Pool({ connectionString: databaseUrl });

    await db.query(`
      ALTER TABLE seller_templates
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS zip_path TEXT,
        ADD COLUMN IF NOT EXISTS zip_original_name TEXT,
        ADD COLUMN IF NOT EXISTS zip_mime TEXT,
        ADD COLUMN IF NOT EXISTS zip_size_bytes BIGINT,
        ADD COLUMN IF NOT EXISTS zip_uploaded_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS preview_url TEXT,
        ADD COLUMN IF NOT EXISTS preview_image TEXT,
        ADD COLUMN IF NOT EXISTS demo_url TEXT,
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Template',
        ADD COLUMN IF NOT EXISTS owner_hold_until TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS owner_withdrawn_at TIMESTAMPTZ;
    `);

    const userResult = await db.query(`
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
    `, [`${slug}@example.com`, 'test-hash']);

    const ownerUserId = userResult.rows[0].id;

    const previewDir = path.join(storageRoot, slug, 'preview');
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(path.join(previewDir, 'preview.png'), tinyPngBuffer());

    await db.query('DELETE FROM seller_templates WHERE slug = $1', [slug]);

    await db.query(`
      INSERT INTO seller_templates (
        owner_user_id,
        title,
        slug,
        short_description,
        description,
        status,
        deleted_at,
        zip_path,
        zip_original_name,
        zip_mime,
        zip_size_bytes,
        zip_uploaded_at,
        category,
        price_buy_cents,
        price_rent_cents
      )
      VALUES (
        $1,
        'Details Preview Contract',
        $2,
        'Real details preview contract.',
        'Details page must render stored preview, not seed placeholder.',
        'published',
        NULL,
        $3,
        'template.zip',
        'application/zip',
        123,
        NOW(),
        'Preview contract',
        10000,
        1000
      )
    `, [
      ownerUserId,
      slug,
      path.join(storageRoot, slug, 'template.zip'),
    ]);

    const mod = await import('../src/app.web.js');
    app = mod.createWebApp({ db });
  });

  afterAll(async () => {
    if (db) {
      await db.query('DELETE FROM seller_templates WHERE slug = $1', [slug]);
      await db.end();
    }
  });

  test('template details page renders reachable stored preview image', async () => {
    const page = await request(app)
      .get(`/templates/${slug}`)
      .expect(200);

    const src = extractPreviewImgSrc(page.text);

    expect(src).toBe(`/t/${slug}/preview/preview.png`);
    expect(src).not.toMatch(/\/img\/templates\/|placeholder|fallback/i);

    const preview = await request(app)
      .get(src)
      .expect(200);

    expect(preview.headers['content-type']).toMatch(/^image\//i);
  });
});
