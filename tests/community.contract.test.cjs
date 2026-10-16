// tests/community.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Community feature contract', () => {
  test('/community is mounted with requireAuthWeb in app.js (registered users only)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');

    // The mount call for '/community' must be guarded by requireAuthWeb,
    // the same middleware already protecting /profile. This is a static
    // wiring check — the actual redirect-to-login behavior for guests is
    // requireAuthWeb's own, already-tested responsibility.
    const communityMountMatch = src.match(
      /webApp\.use\(\s*['"]\/community['"][\s\S]{0,400}?\)\s*;/,
    );

    expect(communityMountMatch).not.toBeNull();
    expect(communityMountMatch[0]).toContain('requireAuthWeb');
    expect(communityMountMatch[0]).toContain('createCommunityPagesRouter');
  });

  test('community router queries filter by user_profiles.public_profile = true (opt-in, not automatic)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/web/routes/community.pages.routes.cjs'),
      'utf8',
    );

    // Both the listing query and the detail query must gate on
    // public_profile = true. If either check goes missing, every
    // registered user would silently become visible without opting in.
    const occurrences = src.match(/public_profile\s*=\s*true/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    expect(src).toContain("res.status(404).render('pages/errors/404')");
  });

  test('header only shows the Community link to authenticated users', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/web/views/partials/site-header.hbs'),
      'utf8',
    );

    const authedBlockMatch = src.match(/{{#if isAuthed}}[\s\S]*?<\/nav>/);
    expect(authedBlockMatch).not.toBeNull();
    expect(authedBlockMatch[0]).toContain('href="/community"');
    expect(authedBlockMatch[0]).toContain('href="/cabinet"');

    // Must not be reachable/visible outside the isAuthed guard.
    const beforeAuthedBlock = src.slice(0, src.indexOf('{{#if isAuthed}}'));
    expect(beforeAuthedBlock).not.toContain('href="/community"');
  });

  test('Basic Information form exposes a public_profile visibility toggle wired to POST /api/profile', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/web/views/partials/space-profile-security.hbs'),
      'utf8',
    );

    expect(src).toContain('name="public_profile"');
    expect(src).toContain('type="checkbox"');
    expect(src).toContain('form.elements.public_profile.checked');
  });

  test('profile.controller.cjs persists public_profile through the same UPSERT as the rest of the profile', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/modules/profile/profile.controller.cjs'),
      'utf8',
    );

    expect(src).toContain("Object.prototype.hasOwnProperty.call(src, 'public_profile')");
    expect(src).toMatch(/INSERT INTO user_profiles[\s\S]*public_profile[\s\S]*ON CONFLICT/);
  });
});
