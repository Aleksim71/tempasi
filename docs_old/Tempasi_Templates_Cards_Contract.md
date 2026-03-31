# Tempasi — Contract: Templates Catalog Cards (MINI / MAXI)

Дата: 2026-02-09  
Scope: `/templates` (WEB catalog listing)

## 1) Термины

- **Card MINI** — режим быстрого обзора (grid). Минимум информации для первичного отбора.
- **Card MAXI** — режим осознанного выбора (list). MINI + расширенные поля (без «маркетинга»).

## 2) Единый объект каталога (TemplateCatalogItem)

Каталог `/templates` должен рендериться из массива объектов `TemplateCatalogItem[]`.

### 2.1 Обязательные поля (MUST)

| Field         | Type                                              | Notes                                                           |
| ------------- | ------------------------------------------------- | --------------------------------------------------------------- | ------------------------ |
| `id`          | `string`                                          | **MUST = slug** (например, `seed-001`). Нужен для legacy путей. |
| `slug`        | `string`                                          | То же, что и `id`, используется в новых местах кода.            |
| `name`        | `string`                                          | Отображаемое имя шаблона.                                       |
| `demoUrl`     | `string`                                          | URL демо (внешний или внутренний). Открывать в новой вкладке.   |
| `detailsUrl`  | `string`                                          | URL страницы деталей внутри сайта (обычно `/templates/:slug`).  |
| `prices.buy`  | `{ amount: number, currency: string }`            | Цена покупки (конкретная).                                      |
| `prices.rent` | `{ amount: number, currency: string, period: 'mo' | 'yr' } \| null`                                                 | Цена аренды (если есть). |
| `previewUrl`  | `string`                                          | URL превью-изображения (статичный скрин).                       |

### 2.2 Поля для MAXI (SHOULD)

| Field         | Type       | Notes                                                                   |
| ------------- | ---------- | ----------------------------------------------------------------------- |
| `author.name` | `string`   | Автор (тихо, вторичным текстом).                                        |
| `tech`        | `string[]` | Каноничные технологии (1 строка в UI, например: `['HTML/CSS', 'HBS']`). |
| `excerpt`     | `string`   | 1–2 строки (обрезать), начало описания автора.                          |

### 2.3 Дополнительные (OPTIONAL)

| Field      | Type      | Notes                                                                  |
| ---------- | --------- | ---------------------------------------------------------------------- |
| `isFree`   | `boolean` | Если free — `prices.buy.amount = 0`, аренду скрываем.                  |
| `license`  | `string`  | PU/CU/EL… **не показывать в MINI**, можно показать в MAXI вторично.    |
| `zipReady` | `boolean` | В каталоге можно не показывать (чтобы не «засорять»), но поле полезно. |
| `meta`     | `object`  | Raw metadata для будущих расширений (не использовать напрямую в UI).   |

## 3) Источник данных: `storage/templates/<slug>/metadata.json`

### 3.1 Минимальная схема `metadata.json` (рекомендуемая)

```json
{
  "name": "Seed 001 — Landing",
  "demoUrl": "https://preview.tempasi.test/t/seed-001/",
  "author": { "name": "John Doe" },
  "tech": ["HTML/CSS", "Handlebars"],
  "excerpt": "Minimal landing template for SaaS. Clean sections, fast load.",
  "prices": {
    "buy": { "amount": 49, "currency": "EUR" },
    "rent": { "amount": 9, "currency": "EUR", "period": "mo" }
  }
}
```

### 3.2 Backward compatibility (если у старых meta другие поля)

Допускается маппинг:

- `title` → `name`
- `price` → `prices.buy.amount` (currency по умолчанию `EUR`)
- `dealType/type`:
  - `free` ⇒ `isFree=true` и `prices.buy.amount=0`
  - `buy` ⇒ только buy
  - `rent` ⇒ rent **и** buy (если buy нет — можно скрыть buy, но предпочтительно иметь оба)
- `description` → `excerpt` (обрезать до 140–180 символов)

## 4) Правила отображения

### 4.1 MINI (Grid)

Показываем строго:

- `previewUrl`
- `name`
- `Demo` → `demoUrl` (target=\_blank, rel=noopener)
- `Details` → `detailsUrl`
- `Buy: <amount><currencySymbol>`
- `Rent: <amount><currencySymbol>/<period>` (только если rent != null и amount > 0)

### 4.2 MAXI (List)

Показываем:

- всё из MINI
- `author.name` (если есть)
- `tech` (если есть) — **одной строкой**
- `excerpt` (если есть) — 1–2 строки, обрезать, без «читать далее»

## 5) Форматирование цены (UI)

- EUR: `49€`
- Rent: `9€/mo` или `9€/month` (выбрать один стандарт; рекомендуем `mo`)

## 6) Гарантии устойчивости (не падать из-за данных)

- Если нет `previewUrl` → использовать плейсхолдер (нейтральный).
- Если нет `rent` → rent-строку не показывать.
- Если нет `demoUrl` → Demo скрыть (или disabled), но карточка остаётся кликабельной на Details.

## 7) Не делать в каталоге (anti-goals)

- Нет маркетинговых «геро»-текстов
- Нет рейтингов/отзывов/звёзд
- Нет лицензий и комплектаций в MINI
- Нет “Buy/Rent кнопок” в листинге — только цены как факт (покупка в Details)
