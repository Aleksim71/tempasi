# 2026-02-04 17:xx Tempasi — Auth mini-аудит безопасности (MVP)

Этот чеклист — практичный минимум, чтобы не словить базовые проблемы (open redirect, session fixation, cookie flags).

---

## 1) Redirect / next — защита от open-redirect

**Риск:** злоумышленник кидает ссылку `/login?next=https://evil.com` → после логина пользователь попадает на внешний сайт.

### Правило safeNextPath

Разрешаем `next` только если:

- строка начинается с `/`
- НЕ начинается с `//`
- НЕ содержит `http://` или `https://`
- НЕ содержит `\`
- длина <= 512
- (опционально) allowlist префиксов: `/profile`, `/orders`, `/templates`, `/`

Если проверка не прошла → игнорируем `next`, используем дефолт `/profile` или `/`.

---

## 2) Session cookie flags

### Минимум (dev+prod)

- `HttpOnly: true`
- `SameSite: Lax`
- `Path: /`

### Прод (обязательно)

- `Secure: true`
- разумный `maxAge` (например 7 дней) или session-only + refresh по активности
- HSTS на nginx (если HTTPS)

---

## 3) Session rotation / fixation

**Риск:** attacker подсунул sid заранее → после логина сохраняется тот же sid.

### MVP-решение

После успешного login:

1. уничтожить старую сессию (если была)
2. создать новую
3. записать туда `userId`

---

## 4) CSRF (web)

Если у тебя web формы (серверные страницы) отправляют POST запросы:

### MVP минимум

- `SameSite=Lax` (уже помогает)
- на POST/PUT/DELETE: проверять `Origin` или `Referer` (должен быть свой домен)
- logout — только POST

### Лучше (следующий шаг)

- CSRF token (double submit cookie или session-based)

---

## 5) Rate limiting / brute force (login/register)

### MVP

- login: лимит по `ip + emailHash` (например 10 попыток / 10 минут)
- register: лимит по ip (например 5 / 10 минут)

Возврат:

- `429 AUTH_TOO_MANY_ATTEMPTS` + `retryAfterSec`

---

## 6) Логи (без утечек)

- не логировать raw email/пароль
- email → `sha256(lower(email))` и только его
- логировать:
  - success login (userId)
  - failed login (reason code, emailHash, ip)
  - logout
  - register

---

## 7) Заголовки и мелочи

- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy` (минимум для web)
- `X-Frame-Options: DENY` (или CSP frame-ancestors)
- `Referrer-Policy: same-origin`

---

## 8) Мини-тесты безопасности (ручные)

- `/login?next=https://example.com` → после логина НЕ уходит наружу
- повторный logout всегда 200, cookie очищается
- login возвращает одинаковый ответ для “нет пользователя” и “неверный пароль”
- cookie в prod имеет Secure

---
