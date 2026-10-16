// tests/myTemplatesListStoredPreview.integration.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Pool } = require('pg');
const { migrateDb } = require('./helpers/migrateDb.cjs');
const bcrypt = require('bcryptjs');
const { createCabinetPagesRouter } = require('../src/web/routes/cabinet.pages.routes.cjs');

const ROOT = path.join(__dirname, '..');

const TEST_UPLOAD_ROOT =
  process.env.TEMPLATE_UPLOAD_DIR ||
  path.join(ROOT, 'tmp', 'test-template-uploads');

process.env.TEMPLATE_UPLOAD_DIR = TEST_UPLOAD_ROOT;

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgAAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function ensureUser(db) {
  const email = `my_templates_preview_${Date.now()}@example.com`;
  const password = 'Passw0rd-preview-test!';
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await db.query(`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING id, email
  `, [email, passwordHash]);

  const columns = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name IN ('email_verified_at', 'verified_at', 'is_email_verified', 'email_verified')
  `);

  const names = new Set(columns.rows.map((r) => r.column_name));

  if (names.has('email_verified_at')) {
    await db.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [result.rows[0].id]);
  }

  if (names.has('verified_at')) {
    await db.query('UPDATE users SET verified_at = NOW() WHERE id = $1', [result.rows[0].id]);
  }

  if (names.has('is_email_verified')) {
    await db.query('UPDATE users SET is_email_verified = TRUE WHERE id = $1', [result.rows[0].id]);
  }

  if (names.has('email_verified')) {
    await db.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [result.rows[0].id]);
  }

  return {
    ...result.rows[0],
    password,
  };
}

async function seedTemplate(db, userId, slug, uploadRoot) {
  const previewPath = path.join(uploadRoot, slug, 'preview', 'preview.png');
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  fs.writeFileSync(previewPath, tinyPngBuffer());

  await db.query('DELETE FROM seller_templates WHERE slug = $1', [slug]);

  await db.query(`
    INSERT INTO seller_templates (
      owner_user_id,
      title,
      slug,
      short_description,
      description,
      status,
      category,
      price_buy_cents,
      price_rent_cents,
      zip_path,
      zip_original_name,
      zip_mime,
      zip_size_bytes,
      zip_uploaded_at,
      created_at,
      updated_at
    )
    VALUES (
      $1,
      'My Templates Stored Preview',
      $2,
      'Stored preview list test',
      'Stored preview list test full description',
      'published',
      'Preview test',
      10000,
      1000,
      $3,
      'template.zip',
      'application/zip',
      123,
      NOW(),
      NOW(),
      NOW()
    )
  `, [
    userId,
    slug,
    path.join(uploadRoot, slug, 'template.zip'),
  ]);
}

function extractTemplatePreviewSrc(html, slug) {
  const cards = [...html.matchAll(/<img\b[\s\S]*?>/gi)].map((m) => m[0]);

  const match = cards.find((tag) =>
    tag.includes(`/t/${slug}/preview/preview.png`) ||
    tag.includes(`/uploads/previews/`)
  );

  if (!match) return '';

  const src = match.match(/\bsrc="([^"]+)"/i);
  return src ? src[1] : '';
}

describe('My Templates list stored preview integration', () => {
  let db;
  let app;
  let createWebApp;
  let uploadRoot;

  beforeAll(async () => {
    uploadRoot = process.env.TEMPLATE_UPLOAD_DIR;

    if (!uploadRoot) {
      throw new Error('TEMPLATE_UPLOAD_DIR is required for this integration test');
    }

    await migrateDb();

    db = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
    });

    ({ createWebApp } = await import('../src/app.web.js'));
    app = createWebApp({ db });

    app.use('/cabinet', (req, _res, next) => {
      const testUserId = req.get('x-test-user-id');

      if (testUserId) {
        req.userId = testUserId;
        req.user = {
          id: testUserId,
          user_id: testUserId,
          userId: testUserId,
        };
      }

      next();
    });

    app.use('/cabinet', createCabinetPagesRouter());
  });

  afterAll(async () => {
    if (db) await db.end();
  });

  test('My Templates list renders slug-based reachable stored preview image', async () => {
    const user = await ensureUser(db);
    const slug = `my-list-preview-${Date.now()}`;

    await seedTemplate(db, user.id, slug, uploadRoot);

    const agent = request.agent(app);

    const page = await agent
      .get('/cabinet/my-templates')
      .set('x-test-user-id', String(user.id))
      .expect(200);

    expect(page.text).toContain(slug);
    expect(page.text).not.toContain(`/uploads/previews/`);

    const src = extractTemplatePreviewSrc(page.text, slug);

    expect(src).toBe(`/t/${slug}/preview/preview.png`);

    const preview = await agent
      .get(src)
      .expect(200);

    expect(preview.headers['content-type']).toMatch(/^image\//i);
    expect(Number(preview.headers['content-length'] || preview.body.length || 0)).toBeGreaterThan(0);
  });
});
