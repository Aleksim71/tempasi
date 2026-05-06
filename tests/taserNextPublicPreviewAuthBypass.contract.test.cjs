// tests/taserNextPublicPreviewAuthBypass.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('TASER-NEXT-C hotfix public Case Preview auth bypass', () => {
  test('parent /cabinet mount allows only tokenized public case preview to bypass auth', () => {
    const app = read('src/app.js');

    expect(app).toContain('function isPublicCasePreviewRequest(req)');
    expect(app).toContain("String(req.method || '').toUpperCase() !== 'GET'");
    expect(app).toContain('/cabinet\\/cases\\/[^/]+\\/preview\\/public');
    expect(app).toContain('function requireCabinetAuthExceptPublicCasePreview(options)');
    expect(app).toContain('if (isPublicCasePreviewRequest(req)) return next();');
    expect(app).toContain("requireCabinetAuthExceptPublicCasePreview({ loginPath: '/login', defaultNext: '/cabinet' })");
  });

  test('public preview route remains before inner cabinet requireAuthPage gate', () => {
    const routes = read('src/web/routes/cabinet.pages.routes.cjs');

    expect(routes).toContain("router.get('/cases/:id/preview/public'");
    expect(routes).toContain('router.use(requireAuthPage);');
    expect(routes.indexOf("router.get('/cases/:id/preview/public'")).toBeLessThan(
      routes.indexOf('router.use(requireAuthPage);'),
    );
  });
});
