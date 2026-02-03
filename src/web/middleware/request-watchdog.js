// src/web/middleware/request-watchdog.js
// Non-blocking request watchdog.
//
// Purpose:
// - Detect "hung" or slow requests during development / troubleshooting.
// - NEVER block the request pipeline.
//
// Behavior:
// - Calls next() immediately.
// - Starts a timer; if request not finished in thresholdMs, logs a warning.
// - Clears timer on finish/close to avoid leaks.
//
// Env:
// - TEMPASI_WATCHDOG_MS (default 2500)

export function requestWatchdog(req, res, next) {
  const thresholdMs = Number(process.env.TEMPASI_WATCHDOG_MS || 2500);

  // Safety: even if misconfigured, never block.
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    next();
    return;
  }

  const startedAt = Date.now();
  let done = false;

  const tid = setTimeout(() => {
    if (done) return;
    const ms = Date.now() - startedAt;
     
    console.warn(`[watchdog] slow request ${ms}ms: ${req.method} ${req.originalUrl}`);
  }, thresholdMs);

  // Don't keep process alive because of watchdog timer
  if (typeof tid.unref === 'function') tid.unref();

  function cleanup() {
    if (done) return;
    done = true;
    clearTimeout(tid);
  }

  res.on('finish', cleanup);
  res.on('close', cleanup);

  // MUST be immediate
  next();
}
