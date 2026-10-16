// tests/casesUxFollowUp.contract.test.cjs
'use strict';

// TEMPASI_CASES_UX_FOLLOWUP (2026-08-16)
// Two follow-up fixes from the same session as cases-buy-error-alert:
//
// 1) The public, tokenized Case preview page's empty states ("Case
//    preview not found" / "No templates to preview yet") had no way
//    back into the site at all — no carousel (it only renders when
//    templates exist), so a visitor landing there was stuck. Added a
//    "Go home" CTA matching the one the 404 page already uses
//    (renderStandalonePage's sibling pattern), same class (.btn
//    .primary), so it's visually consistent with the site's other
//    "nothing here" states.
//
// 2) The catalog page's shared Rent modal (templates/index.hbs)
//    listed the user's cases as checkboxes but never pre-checked the
//    one matching ?caseId=... — unlike template-details.hbs, which
//    already did this. Arriving at the catalog via a case's "Add
//    templates" link (?caseId=X) and renting a template without
//    manually re-ticking the case checkbox got silently rejected by
//    /cart/add's case_required check (case_required only became
//    visible as an alert after the earlier buy_error/cart alert fix —
//    before that it was one more silent redirect). Root cause:
//    templates.routes.js's GET /templates called the same
//    loadUserCasesForTemplateDetails() as the details route but never
//    added the isSelected flag the details route computes separately.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('cases UX follow-up: public preview CTA + catalog rent modal case preselect', () => {
  test('public case preview: both empty-state branches (not-found and no-templates) have a Go home CTA', () => {
    const view = read('src/web/views/pages/case-preview-public.hbs');

    const occurrences = view.match(/<a href="\/" class="btn primary">Go home<\/a>/g) || [];
    expect(occurrences.length).toBe(2);
  });

  test('public case preview: CTA sits inside both .cases-empty blocks, not floating elsewhere', () => {
    const view = read('src/web/views/pages/case-preview-public.hbs');

    // isNotFound branch
    const notFoundBlock = view.match(/isNotFound}}[\s\S]*?<\/div>\s*{{else}}/)[0];
    expect(notFoundBlock).toContain('cases-empty');
    expect(notFoundBlock).toContain('Go home');

    // empty-templates branch
    const emptyTemplatesBlock = view.match(
      /No templates to preview yet[\s\S]*?<\/div>\s*{{\/if}}/,
    )[0];
    expect(emptyTemplatesBlock).toContain('Go home');
  });

  test('templates.routes.js: catalog GET /templates now maps isSelected onto userCases (not just template-details route)', () => {
    const routes = read('src/web/routes/templates.routes.js');

    expect(routes).toContain('TEMPASI_CATALOG_RENT_MODAL_CASE_PRESELECT');
    expect(routes).toContain(
      "isSelected: Boolean(selectedCaseId) && String(item.id) === String(selectedCaseId),",
    );
  });

  test('templates/index.hbs: rent modal case checkbox reads isSelected, matching template-details.hbs pattern', () => {
    const indexView = read('src/web/views/pages/templates/index.hbs');
    const detailsView = read('src/web/views/pages/template-details.hbs');

    expect(indexView).toContain(
      '<input type="checkbox" name="case_ids" value="{{this.id}}" {{#if this.isSelected}}checked{{/if}}>',
    );
    // Same pre-check pattern already used on the details page (sanity
    // check that this test isn't inventing a new convention).
    expect(detailsView).toContain('{{#if this.isSelected}}checked{{/if}}');
  });

  test('normalizeCaseIdParam only accepts UUID-like or numeric ids (documents the constraint the fix relies on)', () => {
    const routes = read('src/web/routes/templates.routes.js');
    const fnSource = routes.match(/function normalizeCaseIdParam[\s\S]*?\n}/)[0];

    // eslint-disable-next-line no-eval
    const normalizeCaseIdParam = eval(`(${fnSource.replace('function normalizeCaseIdParam', 'function')})`);

    expect(normalizeCaseIdParam('c22cee99-5e1b-4934-9836-888f45f99adb')).toBe(
      'c22cee99-5e1b-4934-9836-888f45f99adb',
    );
    expect(normalizeCaseIdParam('123')).toBe('123');
    expect(normalizeCaseIdParam('not-a-valid-id')).toBe(''); // contains "not" -> has non-hex letters
    expect(normalizeCaseIdParam('')).toBe('');
  });
});
