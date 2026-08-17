// tests/caseClientPreviewEmptyStateRouting.contract.test.cjs
'use strict';

// TEMPASI_CLIENT_PREVIEW_EMPTY_STATE_ROUTING (2026-08-17)
//
// "Client preview" always opened the external, tokenized public
// preview page in a new tab — even for a case with zero templates,
// where that page just shows "No templates to preview yet" (now with
// a "Go home" CTA, see the earlier compact-public-preview-empty-state
// patch). Meanwhile "View" already had a much better empty experience
// in-cabinet: navigate within the same tab, show the same-style
// .cases-empty message, AND highlight the "View" nav link as
// is-active — since the browser is actually sitting on that page.
//
// GET /cabinet/cases/:id/preview already existed (renders the same
// carousel/empty-state markup embedded in the cabinet, tab: 'preview')
// but nothing linked to it — every "Client preview" button pointed
// straight at the external publicPreviewUrl instead.
//
// Fix: "Client preview" now conditionally routes —
//   - has templates -> external publicPreviewUrl, target="_blank" (real
//     "here's what I'd show a client" preview, unchanged)
//   - no templates -> internal /cabinet/cases/:id/preview (same-tab,
//     shows the .cases-empty message with a "Browse templates" CTA,
//     and highlights "Client preview" as is-active, matching "View"'s
//     already-good pattern)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Case "Client preview" empty-state routing', () => {
  test('space-cases.hbs: list card routes Client preview based on templatesCount', () => {
    const src = read('src/web/views/partials/space-cases.hbs');

    expect(src).toContain('{{#if templatesCount}}');
    expect(src).toContain('href="{{publicPreviewUrl}}" target="_blank"');
    expect(src).toContain('href="/cabinet/cases/{{id}}/preview"');
  });

  test('space-cases.hbs: VIEW header routes Client preview based on workspaceData.cases.templates.length', () => {
    const src = read('src/web/views/partials/space-cases.hbs');

    expect(src).toContain('{{#if workspaceData.cases.templates.length}}');
    expect(src).toContain(
      'href="/cabinet/cases/{{workspaceData.cases.selectedCase.id}}/preview">Client preview</a>',
    );
  });

  test('space-cases.hbs: PREVIEW panel has its own header actions with Client preview marked is-active', () => {
    const src = read('src/web/views/partials/space-cases.hbs');
    const previewBlock = src.match(
      /\{\{!-- PREVIEW --\}\}[\s\S]*?cases-card__actions--header[\s\S]*?<\/div>\s*<\/div>/,
    )[0];

    expect(previewBlock).toContain('is-active');
    expect(previewBlock).toContain('Client preview');
    expect(previewBlock).toContain('>View</a>');
  });

  test('space-cases.hbs: PREVIEW panel empty state now has a Browse templates CTA, matching VIEW', () => {
    const src = read('src/web/views/partials/space-cases.hbs');

    const previewEmptyBlock = src.match(
      /No templates to preview yet[\s\S]*?<\/div>\s*\{\{\/if\}\}/,
    )[0];
    expect(previewEmptyBlock).toContain('Browse templates');
  });

  test('real render: empty case shows internal preview link (no external link), non-empty case shows external link', () => {
    const hbsLib = require('hbs');
    const partialsRoot = path.join(ROOT, 'src/web/views/partials');

    for (const f of fs.readdirSync(partialsRoot)) {
      if (f.endsWith('.hbs')) {
        hbsLib.registerPartial(f.replace(/\.hbs$/, ''), fs.readFileSync(path.join(partialsRoot, f), 'utf8'));
      }
    }
    hbsLib.handlebars.registerHelper('eq', (a, b) => a === b);

    const src = read('src/web/views/partials/space-cases.hbs');
    const compiled = hbsLib.handlebars.compile(src);

    const emptyOut = compiled({
      workspaceData: {
        cases: {
          tab: 'list',
          tabs: [],
          items: [{ id: 'case-1', title: 'Empty case', templatesCount: 0, publicPreviewUrl: '/pub/1' }],
        },
      },
    });
    expect(emptyOut).toContain('/cabinet/cases/case-1/preview"');
    expect(emptyOut).not.toContain('href="/pub/1"');

    const nonEmptyOut = compiled({
      workspaceData: {
        cases: {
          tab: 'list',
          tabs: [],
          items: [{ id: 'case-2', title: 'Real case', templatesCount: 2, publicPreviewUrl: '/pub/2' }],
        },
      },
    });
    expect(nonEmptyOut).toContain('href="/pub/2"');
    expect(nonEmptyOut).not.toContain('/cabinet/cases/case-2/preview"');
  });
});
