// scripts/taser-next-d-public-preview-smoke.cjs
'use strict';

const http = require('node:http');
const https = require('node:https');

const DEFAULT_CASE_ID = 'd504c948-86a5-42a5-9a2e-34a5e38fb6ff';
const DEFAULT_TOKEN = '0f33670f-f8e2-4d3a-986d-a7d5edbd1951';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function requestText(url) {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'tempasi-taser-next-d-smoke/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body,
          });
        });
      },
    );

    req.setTimeout(10_000, () => {
      req.destroy(new Error(`Request timeout for ${url.toString()}`));
    });

    req.on('error', reject);
    req.end();
  });
}

function fail(message, details) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function assertContains(body, needle, label) {
  if (!body.includes(needle)) {
    fail(`Missing expected content: ${label}`, { needle });
  }
}

function assertNotContains(body, needle, label) {
  if (body.includes(needle)) {
    fail(`Forbidden content found: ${label}`, { needle });
  }
}

function summarizeForbiddenActions(body) {
  const forbidden = [
    { needle: 'Exclude', label: 'Exclude action' },
    { needle: 'Copy to case', label: 'Copy to case action' },
    { needle: 'data-action="exclude"', label: 'exclude data-action' },
    { needle: 'data-action="copy-to-case"', label: 'copy-to-case data-action' },
    { needle: '/copy-to-case', label: 'copy-to-case route' },
    { needle: '/exclude', label: 'exclude route' },
  ];

  return forbidden.filter((item) => body.includes(item.needle));
}

async function main() {
  const args = parseArgs(process.argv);

  const baseUrl = String(args['base-url'] || process.env.TEMPASI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const caseId = String(args['case-id'] || process.env.CASE_ID || DEFAULT_CASE_ID);
  const token = String(args.token || process.env.TOKEN || DEFAULT_TOKEN);
  const expectText = args['expect-text'] || process.env.EXPECT_TEXT || '';

  const url = new URL(`/cabinet/cases/${caseId}/preview/public`, baseUrl);
  url.searchParams.set('token', token);

  console.log('🎯 TASER-NEXT-D public preview smoke');
  console.log(`• URL: ${url.toString()}`);
  console.log(`• Case ID: ${caseId}`);
  console.log('• Goal: public tokenized preview opens without login and without internal actions');

  const response = await requestText(url);
  const location = response.headers.location || '';

  console.log(`\nHTTP ${response.statusCode} ${response.statusMessage || ''}`.trim());
  if (location) console.log(`Location: ${location}`);
  console.log(`Body length: ${response.body.length}`);

  if (response.statusCode === 302 && String(location).includes('/login')) {
    fail('Public preview is still redirected to login', { statusCode: response.statusCode, location });
  }

  if (response.statusCode !== 200) {
    fail('Expected HTTP 200 OK for tokenized public preview', {
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      location,
    });
  }

  assertContains(response.body, '<html', 'HTML document');
  assertNotContains(response.body, '/login?next=', 'login redirect URL in body');

  if (expectText) {
    assertContains(response.body, String(expectText), `custom expected text: ${expectText}`);
  }

  const forbidden = summarizeForbiddenActions(response.body);
  if (forbidden.length > 0) {
    fail('Public preview contains internal-only actions', forbidden);
  }

  const likelyCardMarkers = [
    'template-card',
    'Template',
    'Live demo',
    'View details',
    'preview',
  ];
  const foundMarkers = likelyCardMarkers.filter((marker) => response.body.includes(marker));

  console.log('\nChecks:');
  console.log('✅ HTTP 200 OK');
  console.log('✅ no login redirect');
  console.log('✅ no internal actions: Exclude / Copy to case');
  if (expectText) console.log(`✅ expected text found: ${expectText}`);
  console.log(`ℹ️ card/content markers found: ${foundMarkers.length ? foundMarkers.join(', ') : 'none'}`);

  console.log('\nResult: PASS');
}

main().catch((error) => {
  console.error('\nResult: FAIL');
  console.error(`❌ ${error.message}`);
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exitCode = 1;
});
