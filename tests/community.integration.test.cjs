// tests/community.integration.test.cjs
'use strict';

const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { migrateDb } = require('./helpers/migrateDb.cjs');

// community.pages.routes.cjs uses scripts/db.pool.cjs/getPool(), which reads
// DATABASE_URL. Keep the app's routes and this test's own seeding/assertions
// on the same database (same trick used in
// myTemplatesPublishedVisibleInCatalog.integration.test.cjs).
if (process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@example.test`;
}

async function createUserWithProfile(db, { publicProfile, nickname, about, publicEmail, websiteUrl }) {
  const email = uniqueEmail(publicProfile ? 'community_public' : 'community_private');
  const passwordHash = await bcrypt.hash('Passw0rd-community!', 10);

  const userRes = await db.query(
    `
      INSERT INTO users (email, password_hash, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING id, email
    `,
    [email, passwordHash],
  );
  const user = userRes.rows[0];

  await db.query(
    `
      INSERT INTO user_profiles (user_id, nickname, full_name, about, public_email, website_url, public_profile)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [user.id, nickname, nickname, about || '', publicEmail || '', websiteUrl || '', Boolean(publicProfile)],
  );

  return user;
}

async function createPublishedTemplate(db, ownerUserId, { slug, title, priceBuyCents, priceRentCents }) {
  await db.query(
    `
      INSERT INTO seller_templates (
        owner_user_id, title, slug, short_description, category,
        price_buy_cents, price_rent_cents, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, 'other', $5, $6, 'published', NOW(), NOW())
    `,
    [ownerUserId, title, slug, 'Community integration test fixture', priceBuyCents ?? null, priceRentCents ?? null],
  );
}

describe('Community: opt-in directory (integration, real DB)', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
    await migrateDb();

    const { createWebApp } = await import('../src/app.web.js');
    app = createWebApp({ db });

    // Same test-only auth bypass already used elsewhere in this suite
    // (see myTemplatesPublishedVisibleInCatalog.integration.test.cjs):
    // avoids needing a real login/session/cookie flow just to prove the
    // Community routes behave correctly once a user IS authenticated.
    app.use((req, _res, next) => {
      const testUserId = req.headers['x-test-user-id'];
      if (testUserId) {
        req.userId = String(testUserId);
        req.user = { id: String(testUserId), user_id: String(testUserId), userId: String(testUserId) };
      }
      next();
    });

    const { createCommunityPagesRouter } = require('../src/web/routes/community.pages.routes.cjs');
    app.use('/community', createCommunityPagesRouter());
  });

  afterEach(async () => {
    if (db) await db.end();
  });

  test('listing only shows users who opted in (public_profile = true), not everyone automatically', async () => {
    const visible = await createUserWithProfile(db, {
      publicProfile: true,
      nickname: `Visible_${Date.now()}`,
      about: 'I make exclusive templates.',
    });
    const hidden = await createUserWithProfile(db, {
      publicProfile: false,
      nickname: `Hidden_${Date.now()}`,
      about: 'Should never show up in Community.',
    });

    const res = await request(app)
      .get('/community')
      .set('x-test-user-id', String(visible.id));

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Visible_`);
    expect(res.text).not.toContain(`Hidden_${hidden.id}`);
    // Belt-and-suspenders: the opted-out nickname text itself must not leak.
    const hiddenProfile = await db.query('SELECT nickname FROM user_profiles WHERE user_id = $1', [hidden.id]);
    expect(res.text).not.toContain(hiddenProfile.rows[0].nickname);
  });

  test('member card shows separate counts for published templates for sale vs for rent', async () => {
    const seller = await createUserWithProfile(db, {
      publicProfile: true,
      nickname: `Seller_${Date.now()}`,
    });

    await createPublishedTemplate(db, seller.id, {
      slug: `community-buy-only-${Date.now()}`,
      title: 'Buy only template',
      priceBuyCents: 10000,
      priceRentCents: null,
    });
    await createPublishedTemplate(db, seller.id, {
      slug: `community-rent-only-${Date.now()}`,
      title: 'Rent only template',
      priceBuyCents: null,
      priceRentCents: 500,
    });

    const res = await request(app)
      .get('/community')
      .set('x-test-user-id', String(seller.id));

    expect(res.status).toBe(200);
    expect(res.text).toContain('1 for sale');
    expect(res.text).toContain('1 for rent');
  });

  test('detail page shows about/contact and links to the member\u2019s published templates', async () => {
    const member = await createUserWithProfile(db, {
      publicProfile: true,
      nickname: `Detail_${Date.now()}`,
      about: 'Detail page fixture bio.',
      publicEmail: 'contact@example.test',
      websiteUrl: 'https://example.test',
    });

    const slug = `community-detail-${Date.now()}`;
    await createPublishedTemplate(db, member.id, {
      slug,
      title: 'Detail Page Fixture Template',
      priceBuyCents: 4200,
      priceRentCents: null,
    });

    const res = await request(app)
      .get(`/community/${member.id}`)
      .set('x-test-user-id', String(member.id));

    expect(res.status).toBe(200);
    expect(res.text).toContain('Detail page fixture bio.');
    expect(res.text).toContain('contact@example.test');
    expect(res.text).toContain(`/templates/${slug}`);
  });

  test('detail page 404s for a user who has not opted in', async () => {
    const viewer = await createUserWithProfile(db, { publicProfile: true, nickname: `Viewer_${Date.now()}` });
    const hidden = await createUserWithProfile(db, { publicProfile: false, nickname: `NotPublic_${Date.now()}` });

    const res = await request(app)
      .get(`/community/${hidden.id}`)
      .set('x-test-user-id', String(viewer.id));

    expect(res.status).toBe(404);
  });

  test('detail page 404s for a nonexistent user id', async () => {
    const viewer = await createUserWithProfile(db, { publicProfile: true, nickname: `Viewer2_${Date.now()}` });

    const res = await request(app)
      .get('/community/999999999')
      .set('x-test-user-id', String(viewer.id));

    expect(res.status).toBe(404);
  });
});
