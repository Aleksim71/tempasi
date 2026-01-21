// src/templates-demo.server.js
// Minimal, isolated static server for template demos.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Canonical root for all templates:
// storage/templates/<slug>/
const TEMPLATES_ROOT = path.join(PROJECT_ROOT, 'storage', 'templates');

const app = express();

// Mount /t → storage/templates
// No SSR, no rewrites, just static files.
app.use(
  '/t',
  express.static(TEMPLATES_ROOT, {
    index: ['index.html'],
    fallthrough: false,
  }),
);

// Everything else is not part of the demo server surface.
app.use((req, res) => {
  res.status(404).send('Not found');
});

const host = process.env.TEMPLATES_HOST || process.env.HOST || '127.0.0.1';
const port = Number(process.env.TEMPLATES_PORT || 4001);

app.listen(port, host, () => {
  console.log('[templates-demo] Root:', TEMPLATES_ROOT);
  console.log(`[templates-demo] Listening on http://${host}:${port}`);
});
