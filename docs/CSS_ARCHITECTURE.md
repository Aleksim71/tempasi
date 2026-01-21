# Tempasi — CSS Architecture

Цель: стабильная, предсказуемая и масштабируемая система CSS,
без «перетирания» сеток, превью и карточек между страницами.

---

## 1. Проблема, которую мы решаем

На текущий момент:

- глобальные CSS (`core.css`, `custom.css`)
  **ломают layout страниц каталога**
- `img`, `a`, `* {}` и reset-правила
  **растягивают карточки до 1400×900**
- попытки «resilient CSS» через `data-*`
  **работают, но конфликтуют с глобалкой**

Вывод: **CSS должен быть изолирован по страницам**.

---

## 2. Базовый принцип (ОБЯЗАТЕЛЬНЫЙ)

### ❗ Один тип CSS = одна зона ответственности

| Тип CSS           | Назначение                                    |
| ----------------- | --------------------------------------------- |
| `core.css`        | reset, variables, typography, body            |
| `custom.css`      | общие компоненты (btn, badge, header, footer) |
| `pages/*.css`     | layout конкретной страницы                    |
| `templates/*.css` | marketplace / catalog / cards                 |

---

## 3. Фактическая структура (НОРМА)

```
public/
└── css/
    ├── core.css
    ├── custom.css
    │
    ├── pages/
    │   ├── home.css
    │   ├── template.details.css
    │   └── checkout.success.css
    │
    └── templates/
        ├── templates.catalog.css
        ├── templates.filters.css
        └── templates.card.css
```

---

## 4. Как подключаем CSS (ВАЖНО)

### `main.hbs`

```hbs
<link rel='stylesheet' href='/css/core.css' />
<link rel='stylesheet' href='/css/custom.css' />

{{#if pageCss}}
  <link rel='stylesheet' href='{{pageCss}}' />
{{/if}}
```

---

## 5. Как страница включает свой CSS

```js
res.render('pages/templates/index', {
  title: 'Templates',
  templates,
  pageClass: 'page-templates',
  pageCss: '/css/templates/templates.catalog.css',
});
```

---

## 6. ЖЁСТКОЕ ПРАВИЛО СЕЛЕКТОРОВ

❌ ЗАПРЕЩЕНО

```css
img {
}
a {
}
* {
}
```

✅ РАЗРЕШЕНО

```css
.page-templates .templates-grid {
}
.page-templates .template-card img {
}
```

---

## 7. Каталог шаблонов

Единственный источник layout:

```
/css/templates/templates.catalog.css
```

---

## 8. Почему сейчас «1400×900»

Причина — глобальные правила `img`, `a`, reset.

Решение:

```css
.page-templates .template-card__preview {
  aspect-ratio: 16 / 9;
  overflow: hidden;
}

.page-templates .template-card__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

---

## 9. Временное решение

- вернуть `templates.catalog.css`
- подключать только через `pageCss`
- не трогать `custom.css`

---

## 10. Следующий этап

**CSS-революция**:

- чистка глобальных селекторов
- `@layer`
- строгая изоляция страниц

---

## 11. Якорь

Статус:

- сетка под контролем
- CSS изолирован
- готовы к рефакторингу

Следующий чат:
**Tempasi — CSS Revolution**
