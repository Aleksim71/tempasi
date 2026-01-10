/* eslint-env node */
// scripts/make-previews.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = process.cwd();
const STORAGE_TEMPLATES_DIR = path.join(ROOT, 'storage', 'templates');

// Порт для временного сервера превью (чтобы не мешать dev-серверу)
const PORT = Number(process.env.PREVIEW_PORT || 3100);

// Размер скрина (ровно как в макетах карточек)
const WIDTH = Number(process.env.PREVIEW_W || 1400);
const HEIGHT = Number(process.env.PREVIEW_H || 900);

// Небольшая пауза чтобы шаблон успел отрисоваться
const WAIT_MS = Number(process.env.PREVIEW_WAIT_MS || 800);

// Если хочешь генерить только один шаблон:
// PREVIEW_ONLY=seed-001 node scripts/make-previews.cjs
const ONLY = (process.env.PREVIEW_ONLY || '').trim();

// --------- utils ---------

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listSeedSlugs() {
  if (!exists(STORAGE_TEMPLATES_DIR)) return [];

  return fs
    .readdirSync(STORAGE_TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('seed-'))
    .map((d) => d.name)
    .sort();
}

function findChromeBin() {
  // Можно принудительно указать:
  // CHROME_BIN=/usr/bin/google-chrome-stable node scripts/make-previews.cjs
  if (process.env.CHROME_BIN && exists(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  // Попробуем стандартные бинарники
  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

  for (const name of candidates) {
    try {
      execFileSync(name, ['--version'], { stdio: 'ignore' });
      return name;
    } catch {
      // try next
    }
  }

  return null;
}

function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const elapsed = Date.now() - started;
      if (elapsed > timeoutMs) {
        return reject(new Error(`Server did not start within ${timeoutMs}ms: ${url}`));
      }

      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          return resolve();
        }
        setTimeout(tick, 250);
      });

      req.on('error', () => setTimeout(tick, 250));
    };

    tick();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function screenshotWithChrome(chromeBin, url, outPath) {
  // Важно:
  // --screenshot=<file> сохраняет PNG
  // --window-size=... задаёт viewport
  // --headless=new актуально для новых Chrome/Chromium
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--window-size=${WIDTH},${HEIGHT}`,
    `--screenshot=${outPath}`,
    url,
  ];

  execFileSync(chromeBin, args, { stdio: 'ignore' });
}

// --------- main ---------

(async function main() {
  const chromeBin = findChromeBin();
  if (!chromeBin) {
    console.error('[make-previews] ERROR: Chrome/Chromium not found.');
    console.error('Install google-chrome/chromium or set CHROME_BIN=/path/to/chrome');
    process.exit(1);
  }

  const slugsAll = listSeedSlugs();
  const slugs = ONLY ? slugsAll.filter((s) => s === ONLY) : slugsAll;

  if (!slugs.length) {
    console.log('[make-previews] No templates found in storage/templates');
    process.exit(0);
  }

  // 1) поднимаем сервер
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
    PORT: String(PORT),
  };

  // src/server.js уже есть в проекте (nodemon запускает его в dev),
  // тут запускаем ровно node src/server.js без nodemon.
  const serverProc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  const baseUrl = `http://localhost:${PORT}`;
  const healthUrl = `${baseUrl}/templates`;

  try {
    console.log(`[make-previews] Chrome: ${chromeBin}`);
    console.log(`[make-previews] Server: ${baseUrl}`);
    await waitForServer(healthUrl, 20000);

    console.log(`[make-previews] Found ${slugs.length} templates`);
    console.log(`[make-previews] Viewport ${WIDTH}x${HEIGHT}, wait ${WAIT_MS}ms`);

    for (const slug of slugs) {
      const previewDir = path.join(STORAGE_TEMPLATES_DIR, slug, 'preview');
      const outPath = path.join(previewDir, 'preview.png');

      ensureDir(previewDir);

      // Используем твою удобную страницу /preview/:slug (iframe внутри),
      // чтобы внешний фон/рамка были едиными и красивыми.
      const url = `${baseUrl}/preview/${encodeURIComponent(slug)}`;

      try {
        // даём странице догрузиться (шрифты/iframe)
        await sleep(WAIT_MS);

        screenshotWithChrome(chromeBin, url, outPath);
        console.log(`[make-previews] OK: ${slug} -> ${path.relative(ROOT, outPath)}`);
      } catch (err) {
        console.error(`[make-previews] FAIL: ${slug}`, err);
      }
    }

    console.log('[make-previews] done');
  } finally {
    // 2) гасим сервер
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
  }
})().catch((err) => {
  console.error('[make-previews] fatal', err);
  process.exit(1);
});
