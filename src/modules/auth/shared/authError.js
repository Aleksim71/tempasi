// src/modules/auth/shared/authError.js

/**
 * Standard auth error response:
 * { error: { code: string, message: string } }
 */
export function sendAuthError(res, status, code, message) {
  return res.status(status).json({
    error: { code, message },
  });
}

/**
 * Safe "next" redirect target:
 * - allow only relative paths starting with "/"
 * - block protocol-relative ("//") and absolute urls ("http://", "https://")
 */
export function pickNext(next, fallback = '/') {
  if (!next || typeof next !== 'string') return fallback;

  const value = next.trim();
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;

  return value;
}
