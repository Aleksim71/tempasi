// scripts/gen-previews.mjs
// v4: production-ish previews
// - Screenshots REAL template entry: /t/<slug>/index.html
// - Waits for meaningful content (hero/main/section/h1/etc.)
// - Waits for fonts + images
// - Saves 16:9 viewport screenshot by default (fullPage optional)
// - Flags "suspiciously small" outputs (minBytes)
//
// Writes: storage/templates/<slug>/preview/preview.png
//
// Usage:
//   node scripts/gen-previews.mjs --root=storage/templates --baseUrl=http://127.0.0.1:3000 --concurrency=2 --force=true
//
// Options:
//   --only=seed-001,seed-002
//   --timeoutMs=60000
//   --width=1200 --height=675
//   --fullPage=true
//   --force=true
//   --settleMs=1500
//   --minBytes=12000

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    baseUrl: 'http://127.0.0.1:3000',
    root: 'storage/templates',
    concurrency: 2,
    only: null,
    timeoutMs: 60_000,
    width: 1200,
    height: 675,
    fullPage: false,
    force: false,
    settleMs: 1500,
    minBytes: 12_000
  };

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, vRaw] = arg.slice(2).split('=');
    const v = vRaw ?? '';

    if (k === 'baseUrl' && v) out.baseUrl = v;
    if (k === 'root' && v) out.root = v;
    if (k === 'concurrency' && v) out.concurrency = Math.max(1, Number(v) || 1);
    if (k === 'only' && v) out.only = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (k === 'timeoutMs' && v) out.timeoutMs = Math.max(1000, Number(v) || out.timeoutMs);
    if (k === 'width' && v) out.width = Math.max(200, Number(v) || out.width);
    if (k === 'height' && v) out.height = Math.max(200, Number(v) || out.height);
    if (k === 'settleMs' && v) out.settleMs = Math.max(0, Number(v) || out.settleMs);
    if (k === 'minBytes' && v) out.minBytes = Math.max(0, Number(v) || out.minBytes);
    if (k === 'fullPage' && (v === '1' || v === 'true')) out.fullPage = true;
    if (k === 'force' && (v === '1' || v === 'true')) out.force = true;
  }

  return out;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function listSlugs(templatesRootAbs) {
  const entries = await fs.readdir(templatesRootAbs, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b));
}

async function runPool(items, concurrency, worker) {
  const queue = [...items];
  const results = [];
  const runners = new Array(concurrency).fill(0).map(async () => {
    while (queue.length) {
      const item = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      const r = await worker(item);
      results.push(r);
    }
  });
  await Promise.all(runners);
  return results;
}

async function statSize(p) {
  try {
    const st = await fs.stat(p);
    return st.size || 0;
  } catch {
    return 0;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const templatesRootAbs = path.isAbsolute(opts.root)
    ? opts.root
    : path.resolve(repoRoot, opts.root);

  if (!(await exists(templatesRootAbs))) {
    console.error(`[gen-previews] Templates root not found: ${templatesRootAbs}`);
    process.exit(1);
  }

  let slugs = await listSlugs(templatesRootAbs);
  if (opts.only?.length) slugs = slugs.filter((s) => opts.only.includes(s));

  if (!slugs.length) {
    console.log('[gen-previews] No templates found. Nothing to do.');
    return;
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('[gen-previews] Playwright not found. Install: npm i -D playwright && npx playwright install');
    process.exit(1);
  }

  console.log(`[gen-previews] baseUrl      = ${opts.baseUrl}`);
  console.log(`[gen-previews] root         = ${templatesRootAbs}`);
  console.log(`[gen-previews] slugs        = ${slugs.length}`);
  console.log(`[gen-previews] concurrency  = ${opts.concurrency}`);
  console.log(`[gen-previews] viewport     = ${opts.width}x${opts.height}`);
  console.log(`[gen-previews] fullPage     = ${opts.fullPage ? 'yes' : 'no'}`);
  console.log(`[gen-previews] force        = ${opts.force ? 'yes' : 'no'}`);
  console.log(`[gen-previews] settleMs     = ${opts.settleMs}`);
  console.log(`[gen-previews] minBytes     = ${opts.minBytes}`);

  const browser = await chromium.launch({ headless: true });

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const suspicious = [];

  try {
    await runPool(slugs, opts.concurrency, async (slug) => {
      const outDir = path.join(templatesRootAbs, slug, 'preview');
      const outPath = path.join(outDir, 'preview.png');

      if (!opts.force && (await exists(outPath))) {
        skipped += 1;
        return { slug, status: 'skipped', outPath };
      }

      await ensureDir(outDir);

      const page = await browser.newPage({
        viewport: { width: opts.width, height: opts.height },
        deviceScaleFactor: 1
      });

      try {
        const base = opts.baseUrl.replace(/\/$/, '');

        // Primary: real template entry
        const candidates = [
          `${base}/t/${encodeURIComponent(slug)}/index.html`,
          `${base}/t/${encodeURIComponent(slug)}/preview/index.html`,
          `${base}/preview/${encodeURIComponent(slug)}`
        ];

        let usedUrl = candidates[candidates.length - 1];

        for (const url of candidates) {
          // eslint-disable-next-line no-await-in-loop
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs }).catch(() => null);
          const status = resp ? resp.status() : 0;
          if (status === 200) {
            usedUrl = url;
            break;
          }
        }

        // Network settle (best-effort)
        await page.waitForLoadState('networkidle', { timeout: Math.min(opts.timeoutMs, 25_000) }).catch(() => {});

        // Wait for meaningful content (best-effort).
        // Many templates have main/section/h1/hero/header/nav.
        const contentSelectors = [
          'main',
          'h1',
          'section',
          '.hero',
          '.header',
          'header',
          'nav'
        ];
        for (const sel of contentSelectors) {
          // eslint-disable-next-line no-await-in-loop
          const okSel = await page
            .locator(sel)
            .first()
            .waitFor({ state: 'visible', timeout: 4_000 })
            .then(() => true)
            .catch(() => false);
          if (okSel) break;
        }

        // Wait fonts
        await page.evaluate(async () => {
          // @ts-ignore
          if (document.fonts && document.fonts.ready) {
            // @ts-ignore
            await document.fonts.ready;
          }
        }).catch(() => {});

        // Wait images
        await page.evaluate(async () => {
          const imgs = Array.from(document.images || []);
          await Promise.all(
            imgs.map((img) => {
              if (img.complete) return Promise.resolve();
              return new Promise((resolve) => {
                const done = () => resolve();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
              });
            })
          );
        }).catch(() => {});

        // Let final paints settle
        if (opts.settleMs) await page.waitForTimeout(opts.settleMs);

        await page.screenshot({ path: outPath, fullPage: opts.fullPage });

        const size = await statSize(outPath);
        if (opts.minBytes && size > 0 && size < opts.minBytes) {
          suspicious.push({ slug, bytes: size, url: usedUrl });
        }

        ok += 1;
        return { slug, status: 'ok', outPath, usedUrl, bytes: size };
      } catch (e) {
        failed += 1;
        return { slug, status: 'failed', error: String(e) };
      } finally {
        await page.close().catch(() => {});
      }
    });
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(`[gen-previews] DONE: ok=${ok} skipped=${skipped} failed=${failed}`);

  if (suspicious.length) {
    console.log('');
    console.log(`[gen-previews] Suspicious previews (bytes < ${opts.minBytes}):`);
    for (const s of suspicious.sort((a, b) => a.bytes - b.bytes)) {
      console.log(`- ${s.slug}: ${s.bytes} bytes  (${s.url})`);
    }
  }

  if (failed) process.exitCode = 2;
  else if (suspicious.length) process.exitCode = 3;
}

main().catch((e) => {
  console.error('[gen-previews] Fatal:', e);
  process.exit(1);
});
