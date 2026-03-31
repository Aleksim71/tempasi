# 2026-02-04 17:xx Tempasi — Контракт ошибок Auth (login/register/logout)

Ниже — **точные** контракты для API. Цель: UI всегда знает что делать по `error.code`.

---

## Общий error envelope (везде одинаковый)

### Response (ошибка)

```json
{
  "ok": false,
  "error": {
    "code": "SOME_CODE",
    "message": "Человекочитаемый текст.",
    "field": "email",
    "meta": {}
  }
}
```

> `field` — `null`, если ошибка не привязана к одному полю.

---

## POST /api/auth/register

### Request

```json
{
  "email": "user@example.com",
  "password": "secret123",
  "name": "Alex"
}
```

### 201 Created (успех)

```json
{
  "ok": true,
  "user": {
    "id": "uuid-or-int",
    "email": "user@example.com",
    "name": "Alex"
  }
}
```

### Ошибки

#### 400 AUTH_VALIDATION_FAILED

Когда payload невалиден (пустые поля, формат email, слишком короткий пароль).

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_VALIDATION_FAILED",
    "message": "Проверь поля формы.",
    "field": null,
    "meta": {
      "fields": [
        { "field": "email", "code": "INVALID_EMAIL", "message": "Укажи корректный email." },
        { "field": "password", "code": "WEAK_PASSWORD", "message": "Пароль слишком короткий." }
      ]
    }
  }
}
```

> UI: можно показать общий message + подсветить поля по `meta.fields`.

#### 409 AUTH_EMAIL_TAKEN

Когда email уже существует (уникальный индекс).

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_EMAIL_TAKEN",
    "message": "Этот email уже зарегистрирован.",
    "field": "email",
    "meta": {}
  }
}
```

---

## POST /api/auth/login

### Request

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

### 200 OK (успех)

```json
{
  "ok": true,
  "user": {
    "id": "uuid-or-int",
    "email": "user@example.com",
    "name": "Alex"
  }
}
```

- `Set-Cookie: sid=...; HttpOnly; SameSite=Lax; Path=/; Secure?`

### Ошибки

#### 401 AUTH_INVALID_CREDENTIALS

**Одинаково** для:

- “пользователь не найден”
- “неверный пароль”

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

#### 400 AUTH_VALIDATION_FAILED (опционально)

Если валидируем формат email/пустые поля.

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_VALIDATION_FAILED",
    "message": "Проверь поля формы.",
    "field": null,
    "meta": {
      "fields": [
        { "field": "email", "code": "INVALID_EMAIL", "message": "Укажи корректный email." }
      ]
    }
  }
}
```

#### 429 AUTH_TOO_MANY_ATTEMPTS (если включим rate limit)

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_TOO_MANY_ATTEMPTS",
    "message": "Слишком много попыток. Попробуй позже.",
    "field": null,
    "meta": { "retryAfterSec": 600 }
  }
}
```

---

## POST /api/auth/logout

### Request

без тела

### 200 OK (успех / идемпотентно)

```json
{ "ok": true }
```

- `Set-Cookie: sid=; Max-Age=0; Expires=...; Path=/; HttpOnly; SameSite=Lax; Secure?`

---

## Middleware requireAuth (для API)

### 401 AUTH_REQUIRED

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Нужна авторизация.",
    "field": null,
    "meta": {}
  }
}
```

---

## Таблица кодов (стабильные machine codes)

- `AUTH_VALIDATION_FAILED`
- `AUTH_EMAIL_TAKEN`
- `AUTH_INVALID_CREDENTIALS`
- `AUTH_TOO_MANY_ATTEMPTS` (опц.)
- `AUTH_REQUIRED`

---

## Нюансы безопасности (которые влияют на контракт)

- Login **не раскрывает** существование email.
- Register может возвращать `AUTH_EMAIL_TAKEN` (UX удобно), но:
  - не логируем email в raw виде (только hash)
  - rate limit на register
- Ошибки 500 не отдаем “stack”, только общий `INTERNAL_ERROR`.

---
