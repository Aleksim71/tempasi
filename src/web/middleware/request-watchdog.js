// src/web/middleware/request-watchdog.js
// ESM middleware: request watchdog (debug hangs)

export function requestWatchdog({ timeoutMs = 3000, hardFail = false } = {}) {
  const tMs = Number(timeoutMs);
  const hf = Boolean(hardFail);

  return function requestWatchdogMiddleware(req, res, next) {
    const start = Date.now();
    const id = Math.random().toString(16).slice(2, 8);
    const url = req.originalUrl || req.url;

    console.log(`[WD:${id}] -> ${req.method} ${url}`);

    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      const dur = Date.now() - start;
      console.warn(`[WD:${id}] !! SLOW ${dur}ms ${req.method} ${url}`);

      if (hf && !res.headersSent) {
        res.status(504).type('text').send('504 Gateway Timeout (watchdog)\n');
      }
    }, tMs);

    function cleanup() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const dur = Date.now() - start;
      console.log(`[WD:${id}] <- ${res.statusCode} ${dur}ms ${req.method} ${url}`);
    }

    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);

    return next();
  };
}
