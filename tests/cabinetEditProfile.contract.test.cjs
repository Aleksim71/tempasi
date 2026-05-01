'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('cabinet edit/profile persistence contracts', () => {
  test('my template edit form must not post to /cabinet/my-templates//edit', () => {
    const view = read('src/web/views/partials/space-my-templates.hbs');
    const routes = read('src/web/routes/cabinet.pages.routes.cjs');

    expect(routes).toContain("router.get('/my-templates/:id/edit'");
    expect(routes).toContain("router.post('/my-templates/:id/edit'");

    expect(view).not.toContain('/cabinet/my-templates/{{form.id}}/edit');
    expect(view).not.toContain('/cabinet/my-templates//edit');

    // Edit form should either post to the current URL or to a guaranteed id-based URL.
    expect(view).toMatch(/<form[^>]+method=["']post["'][^>]+(?:action=["']["']|action=["']\/cabinet\/my-templates\/[^"']+\/edit["'])/i);
  });

  test('profile page form submits to /api/profile and sends editable profile fields', () => {
    const view = read('src/web/views/partials/space-profile-security.hbs');

    expect(view).toContain('id="profileForm"');
    expect(view).toContain("fetch('/api/profile'");
    expect(view).toContain("method: 'POST'");
    expect(view).toContain("'Content-Type': 'application/json'");

    expect(view).toContain('name="full_name"');
    expect(view).toContain('name="nickname"');
    expect(view).toContain('name="about"');

    expect(view).toContain('full_name: form.elements.full_name.value');
    expect(view).toContain('nickname: form.elements.nickname.value');
    expect(view).toContain('about: form.elements.about.value');

    expect(view).toMatch(/name=["']full_name["'][\s\S]*?required/i);
    expect(view).toMatch(/name=["']nickname["'][\s\S]*?required/i);
    expect(view).toMatch(/name=["']about["'][\s\S]*?required/i);

    expect(view).not.toContain('<h2 class="section-title">Downloads</h2>');
    expect(view).not.toContain('No downloadable purchases yet.');
  });

  test('cabinet profile page must read authenticated user id from req.userId too', () => {
    const routes = read('src/web/routes/cabinet.pages.routes.cjs');

    expect(routes).toContain('function getUserId(req)');
    expect(routes).toContain('req?.userId');
    expect(routes).toContain('const userId = getUserId(req);');
  });
});
