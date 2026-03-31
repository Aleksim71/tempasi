# Tempasi — Remember me (MVP)

Дата: 2026-02-05
Статус: draft
Область: Auth (web + api), session TTL

## Цель

Чекбокс **Remember me** управляет временем жизни сессии пользователя.

- Без галочки — короткая сессия (безопаснее).
- С галочкой — долгоживущая сессия (удобнее).

## Сценарии

### 1) Remember me = OFF (default)

**Ожидаемое поведение**

- Сессия живёт короткое время (MVP: 2 часа).
- Пользователь чаще перелогинивается.

**Кому подходит**

- Публичные/чужие устройства
- Повышенные требования к безопасности

### 2) Remember me = ON

**Ожидаемое поведение**

- Сессия живёт долго (MVP: 30 дней).
- Пользователь остаётся залогинен после перезапуска браузера.

**Кому подходит**

- Личный ноутбук/телефон
- Маркетплейс/каталог с редкими действиями

## Реализация (MVP)

### Источник значения

Поле `remember` приходит:

- HTML form: `"on"` (checkbox)
- JSON: `true | "true" | "1"`

Сервер нормализует в boolean.

### TTL (секунды)

Значения по умолчанию:

- **SHORT**: 2 часа
- **REMEMBER**: 30 дней

Переопределение через env (опционально):

- `SESSION_TTL_SHORT_SECONDS`
- `SESSION_TTL_REMEMBER_SECONDS`

### Где применяется

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/dev-login`

TTL влияет на:

- `sessions.expires_at` (в БД)
- `Set-Cookie sid` (Max-Age)

## Безопасность

- Cookie: `HttpOnly`, `SameSite=Lax` (и `Secure` в production)
- Logout всегда удаляет запись в `sessions` и очищает cookie, независимо от remember.
- `next` редиректы проходят через safeNextPath (защита от open-redirect).

## Тест-чеклист (ручной)

1. Guest → `/cabinet` → редирект на `/login?next=/cabinet`
2. Login без remember → `Set-Cookie` с Max-Age около 7200
3. Login с remember → `Set-Cookie` с Max-Age около 2592000
4. Logout → cookie очищена + сессия удалена в БД
