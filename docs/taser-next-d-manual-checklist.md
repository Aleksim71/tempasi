# TASER-NEXT-D — manual/browser verification checklist

Цель: пройти реальный пользовательский сценарий после TASER-NEXT-A/B/C и убедиться, что RENT checkout действительно привязывает арендованные шаблоны к выбранному Case, а public preview доступен клиенту без логина.

## Preconditions

- Project path: `/home/aleksim/tempasi`
- Branch: `feat/analytics-kpi-summary`
- App port: `3000`
- Dev/Test Postgres port: `5433`
- Dev app is running: `npm run dev`
- Public preview token migration already applied to `tempasi_dev`

## Focused contract tests

```bash
cd /home/aleksim/tempasi && DATABASE_URL_TEST=postgres://tempasi:tempasi@127.0.0.1:5433/tempasi_test npm test -- --runTestsByPath \
  tests/taserNextCaseContext.contract.test.cjs \
  tests/taserNextCasePreviewRender.contract.test.cjs \
  tests/taserNextPublicPreviewAuthBypass.contract.test.cjs
```

Expected result:

```text
PASS tests/taserNextCaseContext.contract.test.cjs
PASS tests/taserNextCasePreviewRender.contract.test.cjs
PASS tests/taserNextPublicPreviewAuthBypass.contract.test.cjs
```

## Public preview smoke script

Default smoke uses the known dev case/token from the 2026-05-06 Piligrim snapshot.

```bash
cd /home/aleksim/tempasi && node --check scripts/taser-next-d-public-preview-smoke.cjs && node scripts/taser-next-d-public-preview-smoke.cjs
```

Expected result:

```text
HTTP 200 OK
✅ HTTP 200 OK
✅ no login redirect
✅ no internal actions: Exclude / Copy to case
Result: PASS
```

With explicit case/token:

```bash
cd /home/aleksim/tempasi && CASE_ID="d504c948-86a5-42a5-9a2e-34a5e38fb6ff" TOKEN="0f33670f-f8e2-4d3a-986d-a7d5edbd1951" node scripts/taser-next-d-public-preview-smoke.cjs
```

With expected template/case text:

```bash
cd /home/aleksim/tempasi && EXPECT_TEXT="Business 23" node scripts/taser-next-d-public-preview-smoke.cjs
```

## Browser full-flow checklist

1. Open the app.
2. Log in as a buyer/user who can rent templates.
3. Go to `Cases`.
4. Open an existing case or create a new case.
5. Click `Add templates`.
6. Confirm the catalog URL keeps `caseId`.
7. Open one template details page.
8. Confirm the selected case is preselected in the rent/add form.
9. Add RENT to cart.
10. Complete checkout success flow.
11. Return to Case View.
12. Confirm assigned rented template cards are visible.
13. Open public/client preview URL.
14. Confirm public preview opens without login.
15. Confirm public preview shows template cards.
16. Confirm public preview does not show internal actions: `Exclude`, `Copy to case`.
17. Test an empty case.
18. Test a case with multiple rented templates.

## Pass/fail notes

PASS if:

- focused contract tests pass;
- smoke script returns `Result: PASS`;
- real browser flow shows rented templates in Case View and public preview;
- public preview does not redirect to login;
- public preview does not expose internal case actions.

FAIL if:

- public preview redirects to `/login`;
- checkout success does not create/keep `order_case_assignments`;
- selected `caseId` is lost between catalog/details/cart/checkout;
- public preview shows internal action buttons;
- old cart/order flows without selected case are broken.
