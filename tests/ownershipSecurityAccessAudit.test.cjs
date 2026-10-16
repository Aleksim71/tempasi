// tests/ownershipSecurityAccessAudit.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readIfExists(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return '';
  return fs.readFileSync(abs, 'utf8');
}

describe('Step 6J ownership/security access audit', () => {
  test('download service delegates to entitlement checks and BUY-only ZIP access is covered by tests', () => {
    const downloadService = read('src/modules/downloads/downloads.service.cjs');
    const downloadTest = read('tests/downloads.service.test.cjs');

    expect(downloadService).toMatch(/EntitlementsService/i);
    expect(downloadService).toMatch(/hasValidEntitlement|hasActiveEntitlement/i);
    expect(downloadService).toMatch(/NO_ENTITLEMENT|403/i);
    expect(downloadTest).toMatch(/BUY entitlement allows ZIP download/i);
    expect(downloadTest).toMatch(/RENT-only entitlement does not allow ZIP download/i);
  });

  test('download route/controller do not bypass entitlement checks', () => {
    const route = readIfExists('src/web/routes/download.routes.js');
    const controller = readIfExists('src/modules/downloads/downloads.controller.cjs');
    const combined = `${route}\n${controller}`;

    expect(combined).toMatch(/download/i);
    expect(combined).toMatch(/entitlement|downloadsService|downloadService|canDownload|BUY/i);
    expect(combined).not.toMatch(/sendFile\s*\([^)]*template/i);
  });

  test('seller template modules expose ownership-aware operations', () => {
    const repo = read('src/modules/templates/sellerTemplates.repo.cjs');
    const service = read('src/modules/templates/sellerTemplates.service.cjs');
    const combined = `${repo}\n${service}`;

    expect(combined).toMatch(/seller_id|owner_id|user_id|author_id/i);
    expect(combined).toMatch(/seller|owner|user/i);
    expect(combined).toMatch(/where/i);
  });

  test('seller template ZIP module is not an unauthenticated ownership bypass', () => {
    const zipModule = read('src/modules/templates/sellerTemplates.zip.cjs');
    const contract = read('src/modules/templates/templateZip.contract.cjs');
    const combined = `${zipModule}\n${contract}`;

    expect(combined).toMatch(/zip|archive/i);
    expect(combined).toMatch(/template/i);
    expect(combined).toMatch(/seller|owner|user|contract|path|slug/i);
    expect(combined).not.toMatch(/public\s*=\s*true/i);
  });

  test('case rent assignments require active non-expired rent access', () => {
    const source = read('src/modules/cases/rentAssignments.service.cjs');
    const rentContract = read('tests/rentExpirationContract.test.cjs');

    expect(source).toMatch(/active/i);
    expect(source).toMatch(/rent/i);
    expect(source).toMatch(/expires_at|ends_at|end_at/i);
    expect(rentContract).toMatch(/case rent assignment lookup requires active non-expired rent/i);
  });

  test('profile downloads API has authenticated access coverage', () => {
    const source = read('tests/profile.api.test.cjs');

    expect(source).toMatch(/401 when not logged in/i);
    expect(source).toMatch(/returns items when logged in/i);
  });

  test('finance CSV export rejects anonymous access before database lookup', () => {
    const source = read('tests/financeCreditLedger.ui.test.cjs');

    expect(source).toMatch(/CSV export rejects anonymous access before database lookup/i);
  });
});
