# Tempasi — Auth (Overview)

Дата: 2026-02-05
Статус: living doc
Область: Web + API auth, sessions, security

---

## 1) Цели и принципы

Tempasi использует cookie-based sessions (sid), чтобы:

- дать простой и предсказуемый UX в web
- обеспечить чистую интеграцию с API
- иметь контроль над сроком жизни сессий (DB `expires_at`)

Ключевой принцип: **одна ответственность на коммит**
(верстка / логика / доки — отдельно).

---

## 2) Основные маршруты

### API (JSON / HTML redirect)

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET  /api/auth/me`

DEV-only:

- `POST /api/auth/dev-login` (только не-prod)

### Web (страницы)

- `/login`
- `/register`
- protected pages (например `/cabinet`) — через guard + next redirect

---

## 3) Sessions: модель данных

Сессия хранится в таблице `sessions`:

- `id` (sid)
- `user_id`
- `created_at`
- `last_seen_at`
- `expires_at`

Cookie:

- имя: `sid`
- флаги: `HttpOnly`, `SameSite=Lax`
- в production должен быть `Secure`

Истина об истечении — **в БД** (`expires_at`).

---

## 4) Web redirect и `next`

### Зачем нужен `next`

Когда пользователь идёт на защищённую страницу:

- он перенаправляется на `/login?next=/cabinet`
- после логина возвращается на исходную страницу

### Защита от open-redirect

`next` проходит через `safeNextPath()`:

- разрешены только относительные пути вида `/cabinet`
- запрещены `http(s)://`, `//`, `\` и т.п.

### Источники `next`

- query: `?next=/cabinet`
- body: `<input name="next" value="/cabinet">`

Fallback: `/templates`

---

## 5) Remember me (TTL)

Чекбокс `remember` управляет TTL сессии:

- `remember = false` → короткая сессия (MVP: 2 часа)
- `remember = true` → длинная сессия (MVP: 30 дней)

TTL влияет на:

- `sessions.expires_at`
- `Set-Cookie sid` (`Max-Age`)

ENV (опционально):

- `SESSION_TTL_SHORT_SECONDS`
- `SESSION_TTL_REMEMBER_SECONDS`

---

## 6) Rate-limit логина

Маршрут: `POST /api/auth/login`

MVP реализация:

- in-memory Map
- лимит **до** DB/bcrypt
- ключ по умолчанию: `ip + email`
- при успехе счётчик сбрасывается
- ответ при лимите: `429` + `Retry-After`

ENV:

- `LOGIN_RL_WINDOW_SECONDS` (default 600)
- `LOGIN_RL_MAX_ATTEMPTS` (default 10)
- `LOGIN_RL_KEY_MODE=ip|ip_email`

Ограничение MVP:

- для multi-instance нужен Redis-backed limiter

---

## 7) Session rotation (anti-fixation)

При:

- `POST /login`
- `POST /register`
- `POST /dev-login`

если у клиента уже есть `sid`, старая сессия удаляется из БД, затем создаётся новая.

Это:

- предотвращает session fixation
- убирает “залипшие” старые сессии

---

## 8) Proxy / Client IP hardening

По умолчанию `X-Forwarded-For` не используется, чтобы клиент не мог подделать IP.

Использовать XFF можно только при явной конфигурации:

ENV:

- `TRUST_PROXY=1`
- `TRUST_PROXY_IPS=127.0.0.1,::1` (allowlist peer IP прокси)

Поведение:

- `TRUST_PROXY != 1` → берём прямой peer IP
- `TRUST_PROXY == 1` и allowlist задан → XFF только от доверенного прокси
- `TRUST_PROXY == 1` и allowlist пуст → XFF разрешён (не рекомендуется для public)

---

## 9) Ошибки и коды (минимально)

Типовой формат:

```json
{
  "error": { "code": "SOME_CODE", "message": "Human readable message" }
}
```
