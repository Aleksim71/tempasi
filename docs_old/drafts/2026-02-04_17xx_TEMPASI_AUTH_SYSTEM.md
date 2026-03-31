# 2026-02-04 17:xx Tempasi — Auth ошибки и контракты (Polish как система)

Цель: сделать **Auth** предсказуемым для UI/UX и безопасным по умолчанию: единые контракты ошибок, единые тексты, корректный logout (web), строгий `requireAuth`, базовый мини-аудит безопасности.

---

## 0) Scope (что делаем прямо сейчас)

- **Контракт ошибок** для:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
- **Единые тексты** (RU/EN заготовки, RU — основной).
- **Logout (web)**: удаление cookie + корректные коды ответа.
- **Middleware `requireAuth`**: единый вход для API и (при необходимости) для web-страниц.
- **Мини-аудит безопасности**:
  - redirect/next (open-redirect)
  - session cookie flags, rotation, fixation
  - CSRF для web-форм (если они POST-ят в API)
  - rate limit/lockout (минимальный MVP-вариант)

---

## 1) Общие принципы контракта ошибок

### 1.1. Формат ошибки (единый)

**JSON error envelope**:

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Неверный email или пароль.",
    "field": null,
    "meta": {}
  }
}
```

- `code` — стабильный машинный код (для UI/логики).
- `message` — человекочитаемый текст (можно локализовать).
- `field` — имя поля (если ошибка привязана к конкретному input).
- `meta` — доп. данные (не PII, без утечек).

> Важно: **никогда не возвращаем** “email exists” в login (во избежание enumeration).  
> В register можно возвращать `EMAIL_TAKEN`, но аккуратно (см. ниже).

### 1.2. HTTP коды

- `400` — невалидный payload / валидация
- `401` — не авторизован / неверные креды
- `409` — конфликт (email taken)
- `429` — слишком много попыток (если включим rate limit)
- `500` — неожиданное

---

## 2) Конкретные контракты эндпоинтов

Смотри файл: **`2026-02-04_17xx_TEMPASI_AUTH_ERROR_CONTRACTS.md`**.

---

## 3) Единые тексты (минимальный набор)

RU (основной):

- invalid credentials: «Неверный email или пароль.»
- email taken: «Этот email уже зарегистрирован.»
- invalid email: «Укажи корректный email.»
- weak password: «Пароль слишком короткий.»
- required: «Заполни поле.»
- not authenticated: «Нужна авторизация.»

EN (опционально):

- invalid credentials: “Invalid email or password.”
- email taken: “This email is already registered.”
- invalid email: “Please enter a valid email.”
- weak password: “Password is too short.”
- required: “This field is required.”
- not authenticated: “Authentication required.”

---

## 4) Logout (web) — поведение

### 4.1 API

`POST /api/auth/logout`

- Всегда отдаём **200 OK** (идемпотентно), даже если сессии уже нет.
- Обязательно чистим cookie (`sid=; Max-Age=0; Expires=...; Path=/; HttpOnly; SameSite=Lax; Secure?`).

### 4.2 Web

Если web использует формы/кнопку:

- по клику → `POST /api/auth/logout`
- затем redirect на `/login` или `/` (server-side или client-side).

---

## 5) Middleware `requireAuth`

Минимальный контракт:

- Если запрос **к API** (`/api/*`):
  - нет валидной сессии → `401` + envelope
- Если запрос **к web** (`/profile`, `/orders`, ...):
  - нет валидной сессии → `302` на `/login?next=<safe-path>`

---

## 6) Мини-аудит безопасности (checklist)

### 6.1 next redirect (open redirect)

- Разрешать `next` только как:
  - относительный путь, начинающийся с `/`
  - без `//`, без `http(s)://`
  - без `\` (windows)
  - длина ограничена (например 512)
  - (опционально) allowlist префиксов: `/profile`, `/orders`, `/templates`

### 6.2 Session cookie flags

- `HttpOnly` ✅
- `SameSite=Lax` (минимум) ✅
- `Secure` ✅ (в проде всегда; в dev можно условно)
- `Path=/`
- срок жизни: явный (session cookie или maxAge)

### 6.3 Rotation / fixation

- после login (и, опционально, после register) делать **session id rotation**:
  - уничтожить старую сессию
  - создать новую

### 6.4 CSRF

- Если web-формы POST-ят в API на том же домене — риск ниже при `SameSite=Lax`, но:
  - для критичных форм можно добавить CSRF token (double-submit или session-based)
- Для MVP можно:
  - держать logout как POST (не GET)
  - `SameSite=Lax` + `Origin/Referer` check на POST (минимальный вариант)

### 6.5 Rate limit (MVP)

- Лимит на login: например 10 попыток / 10 минут / IP+email-hash
- На register: лимит по IP
- Возвращать `429` с `AUTH_TOO_MANY_ATTEMPTS`

---

## 7) Тест-пакет (минимальный)

- Register:
  - 201 success
  - 400 invalid email
  - 400 weak password
  - 409 email taken
- Login:
  - 200 success → cookie set
  - 401 invalid credentials (и одинаковый ответ для “нет пользователя” и “неверный пароль”)
  - 400 invalid email format (если валидируем)
- Logout:
  - 200 clears cookie
  - 200 even if no session
- requireAuth:
  - API: 401 envelope
  - Web: 302 → /login?next=...

---

## 8) Что дальше (после внедрения контрактов)

1. Привязать UI/страницы: единые сообщения и подсветка field ошибок.
2. Добавить “session rotation” и простейший rate-limit.
3. Пройтись по логированию: auth events без PII (email → hash).
4. Включить продовую настройку cookie `Secure`, HSTS через nginx.

---
