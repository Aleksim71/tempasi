// src/server.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

// Load .env from project root BEFORE importing the app (critical for ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Import app AFTER env is loaded (so db config sees env vars)
const { createApp } = await import('./app.js');

const app = createApp();

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);

app.listen(port, host, () => {
   
  console.log(`[tempasi] listening on http://${host}:${port}`);
});
