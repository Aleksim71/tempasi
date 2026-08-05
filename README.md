# Tempasi

## Template uploads and Live Demo

- Run the app: `npm start` or `npm run dev`.
- Sellers upload a template ZIP directly through the site
  (Cabinet → My Templates → Add). No separate ingest step needed.
- On upload, the app:
  - stores the ZIP itself (`TEMPLATE_UPLOAD_DIR`, a flat,
    randomly-named file),
  - extracts `preview/preview.png` for the catalog thumbnail,
  - extracts the full ZIP contents (best-effort) into
    `TEMPLATE_UPLOAD_DIR/<slug>/` for Live Demo — requires
    `src/index.html` inside the ZIP.
- Live Demo and catalog preview thumbnails are served directly by the
  main app from `TEMPLATE_UPLOAD_DIR` (`GET /t/:slug/*`,
  `GET /t/:slug/preview/preview.:ext`) — no separate process, no
  proxy.
- `TEMPLATE_UPLOAD_DIR` is expected to point at storage physically
  separate from the app server (e.g. an sshfs mount) — that's the
  isolation boundary for uploaded template content, not a second
  local process.
