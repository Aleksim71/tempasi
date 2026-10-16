// tests/catalogPreviewHttp.integration.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Pool } = require('pg');
const { migrateDb } = require('./helpers/migrateDb.cjs');

const ROOT = path.join(__dirname, '..');
const UPLOAD_ROOT = path.join(ROOT, 'uploads', 'templates');

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgAAAAABJRU5ErkJggg==',
    'base64',
  );
}

function extractTemplatePreviewSrcs(html) {
  const imgs = [...html.matchAll(/<img\b[\s\S]*?>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\bclass="[^"]*\btcard__img\b[^"]*"/i.test(tag));

  return imgs
    .map((tag) => {
      const src = tag.match(/\bsrc="([^"]+)"/i);
      const alt = tag.match(/\balt="([^"]*)"/i);

      return {
        tag,
        src: src ? src[1] : '',
        alt: alt ? alt[1] : '',
      };
    })
    .filter((img) => img.src);
}

function writeRealPreviewFile(slug) {
  const dir = path.join(UPLOAD_ROOT, slug, 'preview');
  fs.mkdirSync(dir, { recursive: true });

  const previewPath = path.join(dir, 'preview.png');
  fs.writeFileSync(previewPath, tinyPngBuffer());

  return previewPath;
}

async function ensureSellerTemplatePreviewTestSchema(db) {
  await db.query(`
    ALTER TABLE seller_templates
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS zip_path TEXT,
      ADD COLUMN IF NOT EXISTS zip_original_name TEXT,
      ADD COLUMN IF NOT EXISTS zip_mime TEXT,
      ADD COLUMN IF NOT EXISTS zip_size_bytes BIGINT,
      ADD COLUMN IF NOT EXISTS zip_uploaded_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Template',
      ADD COLUMN IF NOT EXISTS owner_hold_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS owner_withdrawn_at TIMESTAMPTZ;
  `);
}

async function ensurePreviewOwnerUser(db) {
  const existing = await db.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const columnsResult = await db.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
    ORDER BY ordinal_position
  `);

  const columns = columnsResult.rows;
  const insertColumns = [];
  const values = [];
  const params = [];

  function add(column, value) {
    insertColumns.push(column);
    values.push(value);
    params.push(`$${params.length + 1}`);
  }

  const hasColumn = (name) => columns.some((column) => column.column_name === name);

  if (hasColumn('email')) {
    add('email', `preview_owner_${Date.now()}@example.com`);
  }

  if (hasColumn('password_hash')) {
    add('password_hash', 'test-password-hash');
  } else if (hasColumn('password')) {
    add('password', 'test-password-hash');
  }

  if (hasColumn('name')) {
    add('name', 'Preview Owner');
  }

  if (hasColumn('full_name')) {
    add('full_name', 'Preview Owner');
  }

  for (const column of columns) {
    if (column.column_name === 'id') continue;
    if (insertColumns.includes(column.column_name)) continue;
    if (column.is_nullable === 'YES') continue;
    if (column.column_default !== null) continue;

    if (/bool/i.test(column.data_type)) {
      add(column.column_name, false);
    } else if (/int|numeric|decimal|real|double/i.test(column.data_type)) {
      add(column.column_name, 0);
    } else if (/timestamp|date|time/i.test(column.data_type)) {
      add(column.column_name, new Date());
    } else {
      add(column.column_name, `test-${column.column_name}`);
    }
  }

  const result = await db.query(
    `INSERT INTO users (${insertColumns.join(', ')})
     VALUES (${params.join(', ')})
     RETURNING id`,
    values,
  );

  return result.rows[0].id;
}

async function seedCatalogTemplateWithPreview(db, slug) {
  await ensureSellerTemplatePreviewTestSchema(db);
  const ownerUserId = await ensurePreviewOwnerUser(db);
  writeRealPreviewFile(slug);

  await db.query('DELETE FROM seller_templates WHERE slug = $1', [slug]);

  await db.query(`
    INSERT INTO seller_templates (
      owner_user_id,
      title,
      slug,
      short_description,
      price_buy_cents,
      price_rent_cents,
      status,
      zip_path,
      zip_original_name,
      zip_mime,
      zip_size_bytes,
      zip_uploaded_at,
      category,
      deleted_at,
      owner_hold_until,
      owner_withdrawn_at
    )
    VALUES (
      $3,
      'HTTP Preview Contract Template',
      $1,
      'Template with a real stored preview file.',
      9900,
      900,
      'published',
      $2,
      'template.zip',
      'application/zip',
      123,
      NOW(),
      'Preview contract',
      NULL,
      NULL,
      NULL
    );
  `, [slug, `${slug}/template.zip`, ownerUserId]);
}

describe('catalog preview HTTP integration', () => {
  let createWebApp;
  let db;

  beforeAll(async () => {
    await migrateDb();

    db = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
    });

    ({ createWebApp } = await import('../src/app.web.js'));
  });

  afterAll(async () => {
    if (db) {
      await db.end();
    }
  });

  test('rendered catalog template cards use reachable stored preview images', async () => {
    const slug = 'preview-http-real-001';
    await seedCatalogTemplateWithPreview(db, slug);

    const app = createWebApp({ db });

    const page = await request(app)
      .get('/templates')
      .expect(200);

    const previews = extractTemplatePreviewSrcs(page.text);

    expect(previews.length).toBeGreaterThan(0);

    const seededPreview = previews.find((preview) => preview.src.includes(`/t/${slug}/preview/`));

    expect(seededPreview).toBeTruthy();
    expect(seededPreview.src).toMatch(/^\/t\/[^/]+\/preview\/preview\.(png|jpg|jpeg|webp|svg)$/i);
    expect(seededPreview.src).not.toMatch(/placeholder|default|fallback/i);

    const previewResponse = await request(app)
      .get(seededPreview.src)
      .expect(200);

    expect(previewResponse.headers['content-type']).toMatch(/^image\//i);
    expect(Number(previewResponse.headers['content-length'] || previewResponse.body.length || 0))
      .toBeGreaterThan(0);
  });
});
