Tempasi – Analytics v1 packaging

Changed files (see root/changed_files/ and changes.patch):
 - public/css/pages/cabinet.css
 - src/web/routes/cabinet.pages.routes.cjs
 - src/web/views/partials/space-my-templates.hbs
 - src/web/modules/analytics/analytics.cabinet.service.cjs
 - artifacts/notes/analytics_schema_notes.md
 - artifacts/notes/analytics_impl_notes.md

Analytics page:
 - Open after auth: /cabinet/my-templates/analytics
 - Example with sorting: /cabinet/my-templates/analytics?sort=total_revenue&dir=desc

Supported sort keys (query param ?sort=):
 - created_at
 - deleted_at
 - rent_count
 - rent_revenue
 - buy_revenue
 - total_revenue
 - last_order_at

Sort direction (query param ?dir=):
 - asc
 - desc (default if invalid/missing)

Tests & lint status:
 - scripts/death-to-routine.bundle.sh --tests --lint was run.
 - Tests: fail early because DATABASE_URL_TEST is not set (env issue, not related to Analytics code).
 - Lint: passes with existing warnings only; no new lint errors from Analytics changes.
