# Tempasi — Auth Security: Rate-limit & Session Rotation

Дата: 2026-02-05
Статус: draft
Область: Auth / Security / Sessions

---

## Цели

Усилить безопасность аутентификации без ухудшения UX:

1. Защититься от brute-force атак на логин
2. Предотвратить session fixation
3. Сохранить простоту MVP и предсказуемость поведения

---

## 1. Rate-limit логина

### Что защищаем

Маршрут:

- `POST /api/auth/login`

Ограничение применяется **до**:

- запросов к БД
- `bcrypt.compare`

Это защищает ресурсы сервера.

---

### Модель (MVP)

- Тип: **in-memory** (Map)
- Ключ по умолчанию: `ip + email`
- Окно: **10 минут**
- Лимит: **10 попыток**

При превышении:

- HTTP `429 Too Many Requests`
- Заголовок `Retry-After`
- Для web: простой текст
- Для API: JSON-ошибка

---

### Поведение

- Каждая неуспешная попытка увеличивает счётчик
- При **успешном логине** счётчик для ключа **сбрасывается**
- Старые записи автоматически чистятся (opportunistic cleanup)

---

### ENV-настройки

```env
LOGIN_RL_WINDOW_SECONDS=600
LOGIN_RL_MAX_ATTEMPTS=10
LOGIN_RL_KEY_MODE=ip_email   # ip | ip_email
```
