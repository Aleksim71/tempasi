// tests/myTemplatesPublishedVisibleInCatalog.integration.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const request = require('supertest');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { migrateDb } = require('./helpers/migrateDb.cjs');

const ROOT = path.join(__dirname, '..');

const TEST_UPLOAD_ROOT =
  process.env.TEMPLATE_UPLOAD_DIR ||
  path.join(ROOT, 'tmp', 'test-template-uploads');

process.env.TEMPLATE_UPLOAD_DIR = TEST_UPLOAD_ROOT;

// cabinet.pages.routes.cjs uses scripts/db.pool.cjs/getPool(), which reads DATABASE_URL.
// Keep app routes and test assertions on the same database.
if (process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

// IMPORTANT: require after env is prepared, because cabinet route resolves upload dir at module load time.

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgAAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function ensureUser(db) {
  const email = `published_catalog_${Date.now()}@example.com`;
  const password = 'Passw0rd-published-catalog!';
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await db.query(`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING id, email
  `, [email, passwordHash]);

  return {
    ...result.rows[0],
    password,
  };
}

function makeTemplateZip(zipPath) {
  const sourceDir = `${zipPath}.src`;

  fs.mkdirSync(path.join(sourceDir, 'preview'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'docs'), { recursive: true });

  fs.writeFileSync(
    path.join(sourceDir, 'index.html'),
    '<!doctype html><html><body>Published catalog contract</body></html>',
  );

  fs.writeFileSync(path.join(sourceDir, 'preview', 'preview.png'), tinyPngBuffer());
  fs.writeFileSync(path.join(sourceDir, 'docs', 'README.md'), '# Published catalog contract\n');

  childProcess.execFileSync('zip', ['-qr', zipPath, '.'], {
    cwd: sourceDir,
    stdio: 'pipe',
  });
}

describe('My Templates published visibility in public catalog', () => {
  let db;
  let app;
  let createWebApp;
  let tmpDir;

  beforeEach(async () => {
    fs.mkdirSync(TEST_UPLOAD_ROOT, { recursive: true });

    db = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
    });

    await migrateDb();

    ({ createWebApp } = await import('../src/app.web.js'));
    app = createWebApp({ db });

    app.use((req, _res, next) => {
      const testUserId = req.headers['x-test-user-id'];

      if (testUserId) {
        req.userId = String(testUserId);
        req.user = {
          id: String(testUserId),
          user_id: String(testUserId),
          userId: String(testUserId),
        };
      }

      next();
    });
    const { createCabinetPagesRouter } = require('../src/web/routes/cabinet.pages.routes.cjs');
    app.use('/cabinet', createCabinetPagesRouter());

    tmpDir = path.join(ROOT, 'tmp', `published-catalog-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    if (db) await db.end();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('published seller template created from My Templates appears in public /templates catalog with reachable preview', async () => {
    const user = await ensureUser(db);
    const agent = request.agent(app);

    const login = await agent
      .post('/login')
      .type('form')
      .send({
        email: user.email,
        password: user.password,
      });

    expect([200, 302, 303]).toContain(login.status);

    const slug = `published-catalog-${Date.now()}`;
    const title = 'Published Catalog Contract Template';
    const zipPath = path.join(tmpDir, `${slug}.zip`);
    makeTemplateZip(zipPath);

    const add = await agent
      .post('/cabinet/my-templates/add')
      .set('x-test-user-id', String(user.id))
      .field('status', 'published')
      .field('sellingOption', 'buy_rent')
      .field('title', title)
      .field('slug', slug)
      .field('shortDescription', 'This template must be visible in the public catalog.')
      .field('priceBuy', '123')
      .field('priceRent', '7')
      .attach('templateZip', zipPath);

    if (![302, 303].includes(add.status) || add.headers.location !== '/cabinet/my-templates') {
      // eslint-disable-next-line no-console
      console.log('[published-catalog-test] add response', {
        status: add.status,
        location: add.headers.location,
        text: String(add.text || '').slice(0, 2000),
      });
    }

    expect([302, 303]).toContain(add.status);
    expect(add.headers.location).toBe('/cabinet/my-templates');

    const row = await db.query(
      `SELECT id, slug, title, status, zip_path
       FROM seller_templates
       WHERE title = $1
         AND owner_user_id = $2
       ORDER BY id DESC
       LIMIT 1`,
      [title, user.id],
    );

    if (row.rowCount !== 1) {
      const recent = await db.query(
        `SELECT id, slug, title, status, zip_path
         FROM seller_templates
         ORDER BY id DESC
         LIMIT 10`,
      );

      // eslint-disable-next-line no-console
      console.log('[published-catalog-test] row missing', {
        slug,
        addStatus: add.status,
        addLocation: add.headers.location,
        databaseUrl: process.env.DATABASE_URL,
        databaseUrlTest: process.env.DATABASE_URL_TEST,
        recent: recent.rows,
      });
    }

    expect(row.rowCount).toBe(1);
    expect(row.rows[0].status).toBe('published');

    const generatedSlug = row.rows[0].slug;
    expect(generatedSlug).toBeTruthy();
    expect(generatedSlug).not.toBe(slug);

    const storedPreview = path.join(TEST_UPLOAD_ROOT, generatedSlug, 'preview', 'preview.png');
    expect(fs.existsSync(storedPreview)).toBe(true);
    expect(fs.statSync(storedPreview).size).toBeGreaterThan(0);

    const guest = request(app);

    const catalog = await guest
      .get('/templates')
      .expect(200);

    expect(catalog.text).toContain(generatedSlug);
    expect(catalog.text).toContain(title);
    expect(catalog.text).toContain(`/t/${generatedSlug}/preview/preview.png`);
    expect(catalog.text).not.toContain(`/uploads/previews/`);

    const preview = await guest
      .get(`/t/${generatedSlug}/preview/preview.png`)
      .expect(200);

    expect(preview.headers['content-type']).toMatch(/image\/png/i);
    expect(Number(preview.headers['content-length'] || 0)).toBeGreaterThan(0);
  });
});
