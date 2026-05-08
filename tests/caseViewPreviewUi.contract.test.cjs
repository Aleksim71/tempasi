// tests/caseViewPreviewUi.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('case view / preview UI contract', () => {
  test('case list uses final case action labels without internal preview', () => {
    const hbs = read('src/web/views/partials/space-cases.hbs');

    expect(hbs).toContain('>View</a>');
    expect(hbs).not.toContain('>Preview</a>');
    expect(hbs).toContain('>Client preview</a>');
    expect(hbs).toContain('>Add templates</a>');
    expect(hbs).toContain('>Clear</button>');
    expect(hbs).toContain('>Delete</button>');

    expect(hbs).not.toContain('>Open</a>');
    expect(hbs).not.toContain('>Demo</a>');
    expect(hbs).not.toContain('>Close</button>');
    expect(hbs).not.toContain('Status: {{status}}');
  });

  test('case view has template-level actions without case-level naming collisions', () => {
    const hbs = read('src/web/views/partials/space-cases.hbs');

    expect(hbs).toContain('data-tempasi-view-mode="internal-case-view"');
    expect(hbs).toContain('>Details</a>');
    expect(hbs).toContain('>Live Demo</a>');
    expect(hbs).toContain('>Exclude</button>');
    expect(hbs).toContain('>Copy to case</button>');
  });

  test('case preview is presentation-only and links to template details and live demo', () => {
    const hbs = read('src/web/views/partials/space-cases.hbs');

    expect(hbs).toContain('Presentation preview');
    expect(hbs).toContain('>View details</a>');
    expect(hbs).toContain('>Live demo</a>');
  });

  test('cabinet routes expose view, preview, clear, exclude and copy endpoints', () => {
    const routes = read('src/web/routes/cabinet.pages.routes.cjs');

    expect(routes).toContain("router.get('/cases/:id'");
    expect(routes).toContain("router.get('/cases/:id/preview'");
    expect(routes).toContain("router.post('/cases/:id/clear'");
    expect(routes).toContain("router.post('/cases/:caseId/templates/:orderId/exclude'");
    expect(routes).toContain("router.post('/cases/:caseId/templates/:orderId/copy'");
  });
});
