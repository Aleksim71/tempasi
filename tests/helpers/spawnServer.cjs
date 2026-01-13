'use strict';

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

function httpGetJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function waitForHealth(baseUrl, totalMs = 8000) {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await httpGetJson(`${baseUrl}/__health`, 1200);
      if (r.status === 200) return true;
    } catch (_) {}

    if (Date.now() - startedAt > totalMs) {
      throw new Error(`[spawnServer] healthcheck timeout: ${baseUrl}/__health`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function startServer({ databaseUrlTest }) {
  const cwd = path.join(process.cwd());

  // Запускаем через node, чтобы nodemon не мешал тестам
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TEMPASI_SKIP_SSR: '1',
      HOST: '127.0.0.1',
      PORT: '0',
      DATABASE_URL: databaseUrlTest,
    },
  });

  let out = '';
  let baseUrl = '';
  const reListen = /\[tempasi\] listening on http:\/\/([^\s:]+):(\d+)/;

  child.stdout.on('data', (d) => {
    out += String(d);
    const m = String(d).match(reListen);
    if (m) {
      const host = m[1];
      const port = Number(m[2]);
      baseUrl = `http://${host}:${port}`;
    }
  });

  child.stderr.on('data', (d) => {
    out += String(d);
  });

  // ждём пока распечатает listen
  const started = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[spawnServer] did not start (no listen line). Output:\n${out}`));
    }, 8000);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (code=${code}, signal=${signal}). Output:\n${out}`));
    });

    const tick = setInterval(() => {
      if (baseUrl) {
        clearInterval(tick);
        clearTimeout(timer);
        resolve(true);
      }
    }, 50);
  });

  if (!started) {
    child.kill('SIGTERM');
    throw new Error(`[spawnServer] failed to start. Output:\n${out}`);
  }

  // И ждём health
  await waitForHealth(baseUrl);

  return {
    baseUrl,
    child,
    stop: async () => {
      if (!child || child.killed) return;
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 150));
    },
  };
}

module.exports = { startServer };
