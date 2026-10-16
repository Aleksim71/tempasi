# Tempasi

A marketplace for website templates with two ways to get one:
**rent** it for a period, or **buy** it exclusively — every template can be
sold only once, after which it leaves the catalog.

Sellers upload a template as a ZIP from their cabinet; the app validates it,
extracts a preview for the catalog and publishes a live demo. Buyers pay
through a payment provider, and access to downloads is granted by
entitlements, never by the page that showed the button.

Node.js · Express 5 · PostgreSQL · server-side rendering with Handlebars ·
Jest + Supertest (276 tests).

## What works end to end

- **Accounts:** registration with email verification, login with sessions
  (short and "remember me" lifetimes), password reset, profile editing,
  self-service account deletion.
- **Catalog and templates:** categories, search, template pages with a live
  demo. Seller cabinet: add / edit / publish / withdraw templates.
- **Template upload:** ZIP validated against a contract (`index.html`,
  `preview/preview.png`, size and structure limits, no symlinks); the preview
  is extracted for the catalog, the content is unpacked with restricted
  permissions (dirs `2750`, files `640`).
- **Isolation of seller content:** live demos are served from a separate
  origin (`PREVIEW_ORIGIN`); `/t/*` on the main site only redirects there, so
  uploaded HTML never runs on the application's origin.
- **Buying and renting:** cart, checkout, orders, rent periods with
  expiration. An exclusive BUY is protected at three levels: checkout logic,
  a database constraint (one paid BUY per template) and an idempotent webhook.
- **Payments:** provider abstraction with Stripe and a fake provider for
  development. The fake provider is refused in production
  (`PAYMENTS_UNAVAILABLE`).
- **Account credits:** a credit ledger; credit reserved during checkout is
  released or consumed when the payment webhook confirms the outcome, with
  an audit trail and CSV export in the finance view.
- **Downloads:** only with a valid entitlement (bought, or rented and not
  expired).
- **Admin:** roles, audit log, blocking templates, catalog and commission
  settings.
- **Seller analytics:** KPI summary computed in the database.

## Architecture in short

```
src/
  server.js          entry point
  app.js             API + middleware wiring (ESM)
  app.web.js         SSR pages (Handlebars views in src/web/views)
  modules/           domain modules, one folder each:
                     auth, templates, orders, payments, finance,
                     downloads, profile, cases, admin, storage
  web/               SSR routes, page services, middleware
  config/            db connection, payments, dev-only flags
  lib/               shared helpers (mailer, password hashing)
  db/migrations/     SQL migrations          (see "Known gaps")
sql/migrations/      more SQL migrations     (see "Known gaps")
scripts/             backups, restore, preview generation, maintenance
tests/               Jest: unit, contract, integration and e2e flows
```

Decisions worth knowing:

- **Entitlements are the single source of truth for access.** Orders record
  what was paid; entitlements record what a user may download, and until
  when.
- **Exclusivity is enforced by the database,** not only by application code,
  so two concurrent checkouts cannot both sell the same template.
- **Webhooks are idempotent:** a repeated provider event does not create a
  second entitlement.
- **Dev switches cannot leak into production:** `TEMPASI_SKIP_AUTH` makes the
  app refuse to start when `NODE_ENV=production`; demo and fake checkout
  paths are disabled in production unless explicitly enabled.

## Running locally

Requires Node.js 22 and PostgreSQL 16+.

```bash
npm ci
cp .env.example .env        # fill in DATABASE_URL and the upload directories
npm run dev                 # http://localhost:3000
```

## Tests

Integration tests need their own database whose name ends in `_test`:

```bash
createdb tempasi_test
DATABASE_URL_TEST=postgres://USER:PASSWORD@127.0.0.1:5432/tempasi_test npm test
npm run lint
```

The test setup builds the schema in that database itself, forces
`NODE_ENV=test`, ignores `PG*` variables from the shell and refuses to touch
any database whose name does not end in `_test` — a test run cannot reach a
development or production database by accident.

## Known gaps

Honest list of what is not done yet:

- **No single migration path from an empty database.** Migrations live in two
  folders (`src/db/migrations`, `sql/migrations`), and the base `users` table
  has no migration of its own (the test helper creates it). Existing
  databases are fine; a fresh setup currently needs a schema dump.
  Next step: one folder, a baseline migration and a small runner with a
  `schema_migrations` table.
- **Mixed module systems:** the app is ESM, many modules are still CommonJS
  (`.cjs`) loaded through `createRequire`.
- **Dev tooling advisories:** `npm audit` reports issues in Jest/nodemon
  dependencies (dev only, not shipped); production dependencies are clean
  (`npm audit --omit=dev`). Upgrading to Jest 30 is pending.
