// tests/myTemplatesAddStoredPreview.integration.test.cjs
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const request = require('supertest');
const { Pool } = require('pg');
const { migrateDb } = require('./helpers/migrateDb.cjs');

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgAAAAABJRU5ErkJggg==',
    'base64',
  );
}

function makeTemplateZip(slug) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `tempasi-${slug}-`));
  const zipPath = path.join(root, `${slug}.zip`);

  fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
  fs.writeFileSync(path.join(root, 'preview', 'preview.png'), tinyPngBuffer());
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body>Preview contract template</body></html>');

  execFileSync('zip', ['-qr', zipPath, 'index.html', 'preview'], { cwd: root });

  return zipPath;
}

async function ensureUser(db) {
  const email = `my_templates_add_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`;

  const result = await db.query(`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ($1, 'hash', NOW(), NOW())
    RETURNING id, email
  `, [email]);

  return result.rows[0];
}

describe('My Templates add stored preview integration', () => {
  let db;
  let app;
  let uploadRoot;
  let sellerTemplatesService;

  beforeAll(async () => {
    uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tempasi-template-upload-'));
    process.env.TEMPLATE_UPLOAD_DIR = uploadRoot;

    await migrateDb();

    db = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
    });

    sellerTemplatesService = require('../src/modules/templates/sellerTemplates.service.cjs');

    const mod = await import('../src/app.web.js');
    app = mod.createWebApp({ db });
  });

  afterAll(async () => {
    if (db) await db.end();
  });

  test('seller template add stores DB row and extracts preview to slug-based storage route', async () => {
    const user = await ensureUser(db);
    const slug = `stored-preview-add-${Date.now()}`;
    const title = 'Stored Preview Add Contract';
    const zipPath = makeTemplateZip(slug);

    await sellerTemplatesService.addSellerTemplate({
      pool: db,
      user,
      body: {
        title,
        slug,
        shortDescription: 'Created through seller template service',
        priceBuy: '99',
        priceRent: '9',
        status: 'published',
        sellingOption: 'buy_rent',
      },
      file: {
        path: zipPath,
        originalname: `${slug}.zip`,
        mimetype: 'application/zip',
        size: fs.statSync(zipPath).size,
      },
    });

    const row = await db.query(`
      SELECT id, slug, title, status, zip_path
      FROM seller_templates
      WHERE title = $1
        AND owner_user_id = $2
      ORDER BY id DESC
      LIMIT 1
    `, [title, user.id]);

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].status).toBe('published');
    expect(row.rows[0].zip_path).toBeTruthy();

    const generatedSlug = row.rows[0].slug;
    expect(generatedSlug).toBeTruthy();
    expect(generatedSlug).not.toBe(slug);

    const storedPreview = path.join(uploadRoot, generatedSlug, 'preview', 'preview.png');
    expect(fs.existsSync(storedPreview)).toBe(true);
    expect(fs.statSync(storedPreview).size).toBeGreaterThan(0);

    const previewResponse = await request(app)
      .get(`/t/${generatedSlug}/preview/preview.png`)
      .expect(200);

    expect(previewResponse.headers['content-type']).toMatch(/^image\/png/i);

    const detailsResponse = await request(app)
      .get(`/templates/${generatedSlug}`)
      .expect(200);

    expect(detailsResponse.text).toContain(`/t/${generatedSlug}/preview/preview.png`);
    expect(detailsResponse.text).not.toContain(`/uploads/previews/${row.rows[0].id}.png`);
  });
});
