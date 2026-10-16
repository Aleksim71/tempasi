// tests/catalogPublishedPreviewCompleteness.local.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Pool } = require('pg');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getStorageRoot() {
  return requiredEnv('TEMPLATE_UPLOAD_DIR');
}

function expectedPreviewFiles(storageRoot, slug) {
  return ['png', 'jpg', 'jpeg', 'webp', 'svg'].map((ext) =>
    path.join(storageRoot, slug, 'preview', `preview.${ext}`),
  );
}

function findExistingPreview(storageRoot, slug) {
  return expectedPreviewFiles(storageRoot, slug).find((file) => fs.existsSync(file)) || null;
}

const describeLocalPreviewAudit = process.env.TEMPLATE_UPLOAD_DIR ? describe : describe.skip;

describeLocalPreviewAudit('local published catalog preview completeness audit', () => {
  let db;
  let createWebApp;

  beforeAll(async () => {
    const databaseUrl = requiredEnv('DATABASE_URL_TEST');
    const storageRoot = getStorageRoot();

    if (!path.isAbsolute(storageRoot)) {
      throw new Error(`TEMPLATE_UPLOAD_DIR must be an absolute path. Received: ${storageRoot}`);
    }

    db = new Pool({ connectionString: databaseUrl });
    ({ createWebApp } = await import('../src/app.web.js'));
  });

  afterAll(async () => {
    if (db) await db.end();
  });

  test('every published seller template has a real reachable stored preview image', async () => {
    const storageRoot = getStorageRoot();

    const { rows } = await db.query(`
      SELECT id, slug, title
      FROM seller_templates
      WHERE status = 'published'
        AND deleted_at IS NULL
        AND owner_withdrawn_at IS NULL
      ORDER BY id ASC
    `);

    expect(rows.length).toBeGreaterThan(0);

    const missingFiles = [];

    for (const template of rows) {
      const previewFile = findExistingPreview(storageRoot, template.slug);

      if (!previewFile) {
        missingFiles.push({
          id: template.id,
          slug: template.slug,
          title: template.title,
          checked: expectedPreviewFiles(storageRoot, template.slug),
        });
      }
    }

    expect({
      storageRoot,
      missingFiles,
    }).toEqual({
      storageRoot,
      missingFiles: [],
    });

    const app = createWebApp({ db });
    const brokenHttp = [];

    for (const template of rows) {
      const url = `/t/${encodeURIComponent(template.slug)}/preview/preview.png`;
      const response = await request(app).get(url);

      if (response.status !== 200 || !String(response.headers['content-type'] || '').startsWith('image/')) {
        brokenHttp.push({
          id: template.id,
          slug: template.slug,
          title: template.title,
          url,
          status: response.status,
          contentType: response.headers['content-type'] || '',
        });
      }
    }

    expect({
      storageRoot,
      brokenHttp,
    }).toEqual({
      storageRoot,
      brokenHttp: [],
    });
  });
});
