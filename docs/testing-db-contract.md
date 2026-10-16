# Tempasi — Test DB Execution Contract

## Purpose

This document fixes the local test database contract for Tempasi.

DB-backed test runs must fail early when PostgreSQL authentication or configuration is wrong.

## Canonical rule

`DATABASE_URL_TEST` is preferred for tests.

Fallback:

```text
DATABASE_URL_TEST -> DATABASE_URL
```

## Preflight command

```bash
npm run test:db:check
```

The command:

1. selects `DATABASE_URL_TEST` if available;
2. falls back to `DATABASE_URL`;
3. masks the password in terminal output;
4. connects to PostgreSQL;
5. prints database/user/server information;
6. fails early with a clear message if auth/config is wrong.

## Full DB-backed test pattern

```bash
DATABASE_URL_TEST='<WORKING_TEST_DB_URL>' npm test
```

Or, if `DATABASE_URL_TEST` is already exported:

```bash
npm run test:db
```

## Why this matters

Finance, checkout, rent, buy, credit reservation, credit application and credit release flows are DB-backed.

A broken DB connection can make a correct patch look broken. The preflight separates environment problems from real application regressions.
