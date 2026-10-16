// src/config/devFlags.js
//
// Development-only switches. They exist to make local SSR work easier and
// must never change behaviour in production: a dev flag set on the
// production server is treated as a misconfiguration and stops the app.

export function isAuthSkipped() {
  if (!process.env.TEMPASI_SKIP_AUTH) return false;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'TEMPASI_SKIP_AUTH is set while NODE_ENV=production. Refusing to bypass authentication.',
    );
  }
  return true;
}
