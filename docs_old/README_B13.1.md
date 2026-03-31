# Tempasi â B13.1 (Real Auth via Cookie Sessions)

This bundle adds **real auth** for Tempasi by introducing a cookie-based session (`sid`) stored in Postgres.
It is designed to replace the DEV header `x-dev-user-id`.

## Contents

- `migrations/2026-01-10_create_sessions.sql` â sessions table
- `src/db.pool.cjs` â minimal PG Pool singleton (delete/replace if you already have a pool)
- `src/middlewares/auth.middleware.cjs` â `loadUserFromSession` + `requireAuth` + cookie helpers
- `src/modules/auth/auth.routes.cjs` â DEV login + logout
- `scripts/dev-buy.sh` â updated smoke flow using cookie session

## 1) Apply DB migration

Run your migration runner, or manually:

```sql
\i migrations/2026-01-10_create_sessions.sql
```

## 2) Wire middleware globally

In your Express app bootstrap (e.g. `src/app.cjs`, `src/server.cjs`, etc.):

1. Import and mount `loadUserFromSession` **before** any routes that need auth.

```js
const { loadUserFromSession } = require('./src/middlewares/auth.middleware.cjs');
app.use(loadUserFromSession);
```

2. Mount auth routes:

```js
const { authRouter } = require('./src/modules/auth/auth.routes.cjs');
app.use('/api/auth', authRouter);
```

## 3) Protect routes and remove x-dev-user-id

Replace your DEV user resolution with `req.user.id`:

- `POST /api/orders/:slug/buy`
- `GET /download/:slug`
- (recommended) `GET /checkout/success?order_id=...`

Example (conceptually):

```js
const { requireAuth } = require('./src/middlewares/auth.middleware.cjs');
router.post('/api/orders/:slug/buy', requireAuth, controller.buy);
// inside controller: const userId = req.user.id;
```

## 4) Smoke test

1. Start server in DEV.

2. Login via DEV endpoint:

```bash
curl -i -c /tmp/c.txt -H 'Content-Type: application/json' \
  -d '{"userId":"1"}' \
  http://127.0.0.1:3000/api/auth/dev-login
```

3. Run the updated smoke:

```bash
npm run dev:buy -- seed-001
```

## Notes

- Cookie is `HttpOnly` + `SameSite=Lax`; in production it also sets `Secure`.
- Session TTL is controlled by `SESSION_TTL_SECONDS` (default 30 days).
- If you already have a PG pool, remove `src/db.pool.cjs` and point imports to your existing pool.
  EOFcat > /home/oai/share/tempasi_b13/README_B13.1.md <<'EOF'

# Tempasi - B13.1 (Real Auth via Cookie Sessions)

This bundle adds real auth for Tempasi by introducing a cookie-based session (sid) stored in Postgres.
It is designed to replace the DEV header x-dev-user-id.

## Contents

- migrations/2026-01-10_create_sessions.sql - sessions table
- src/db.pool.cjs - minimal PG Pool singleton (delete/replace if you already have a pool)
- src/middlewares/auth.middleware.cjs - session loader + requireAuth
- src/modules/auth/auth.routes.cjs - DEV login + logout
- scripts/dev-buy.sh - updated smoke script that logs in via cookie

## Integration steps (Tempasi app)

1. Run migration

Apply:

- migrations/2026-01-10_create_sessions.sql

2. Mount session loader early

In your Express app setup (before routes), mount:

```js
const { loadUserFromSession } = require('./src/middlewares/auth.middleware.cjs');
app.use(loadUserFromSession);
```

3. Mount auth routes

```js
const { authRouter } = require('./src/modules/auth/auth.routes.cjs');
app.use('/api/auth', authRouter);
```

4. Protect Orders + Download

Add requireAuth to:

- POST /api/orders/:slug/buy
- GET /download/:slug
- (recommended) GET /checkout/success?order_id=...

Conceptually:

```js
const { requireAuth } = require('./src/middlewares/auth.middleware.cjs');
router.post('/api/orders/:slug/buy', requireAuth, controller.buy);
// inside controller: const userId = req.user.id;
```

5. Smoke

Start server in DEV, then:

```bash
npm run dev:buy -- seed-001
```

Notes:

- Cookie is HttpOnly + SameSite=Lax; in production it also sets Secure.
- Session TTL is controlled by SESSION_TTL_SECONDS (default 30 days).
