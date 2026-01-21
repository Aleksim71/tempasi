# Tempasi

## Static templates demo server

- Run main app (catalog, SSR, API): `npm start` or `npm run dev`.
- Run isolated demo server for HTML templates: `npm run start:templates-demo` (port `4001` by default).
  - Mounts `/t` → `storage/templates/` and serves static files only (no SSR, no rewrites).

## Template ingest pipeline

- Ingest a designer ZIP into `storage/templates/<slug>/`:
  - `node ingest-template.js storage/inbox/seed-011.zip`
- Requirements:
  - ZIP contains `metadata.json`, `src/index.html`, `preview/preview.png`.
  - All asset paths in HTML are relative.
  - No `node_modules`, symlinks, or files larger than 10 MiB.
- On success:
  - Template files are placed into `storage/templates/<slug>/`.
  - `storage/templates/<slug>/index.html` is generated as a redirect to `./src/`.
  - Demo URL on the demo server: `/t/<slug>/`.
