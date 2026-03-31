# Tempasi CSS structure (proposed)

Цель: перестать «ломать» сайт глобальными правилами и подключать стили **как кирпичики** (page-scoped).

## 1) Слои стилей

1. **core.css** — база/ресеты/типографика/общие компоненты.
2. **custom.css** — проектные переменные, темы, глобальные уточнения.
3. **page CSS** — _только для одной страницы_ (каталог, профиль, checkout и т.п.)

`main.hbs` уже поддерживает это через переменную:

```hbs
{{#if pageCss}}
  <link rel='stylesheet' href='{{pageCss}}' />
{{/if}}
```

## 2) Правило безопасности

Page CSS **не должен**:

- задавать глобальные правила для `img`, `a`, `button`, `*` (кроме как **внутри** `.templates-page` / `.profile-page` и т.д.)
- переопределять базовые переменные проекта без префикса страницы.

Page CSS **может**:

- жёстко ограничивать стили внутри контейнера страницы (например `.templates-page img { ... }`)

## 3) Где лежат файлы

Рекомендуемая структура:

```
public/css/
  core.css                 # global base
  custom.css               # global theme tweaks
  pages/
    templates.catalog.css   # /templates only
    template.details.css    # /templates/:slug only (если нужно)
    profile.css             # /profile only
```

Если пока не хочешь папку `pages/`, можно оставить как сейчас:
`public/css/templates.catalog.css`

Главное: подключать **через pageCss**, а не глобально в `main.hbs`.

## 4) Как подключать CSS на страницу

В контроллере рендера (SSR):

```js
res.render('pages/templates/index', {
  title: 'Templates',
  activePage: 'templates',
  pageCss: '/css/templates.catalog.css',
  pageJs: '/js/templates.filters.js', // опционально
  templates,
});
```

## 5) Почему ломалась сетка

Обычно причина — **глобальное правило для img** (например фиксированная `width: 1400px`),
которое раздувало картинку превью и ломало размеры карточки.

Фикс в `templates.catalog.css` сделан так:

- превью-обёртка задаёт `aspect-ratio: 16/9`
- картинка внутри: `width/height: 100%` + `object-fit: cover`
- дополнительно: `.templates-page img { max-width: 100% !important; }` чтобы «перебить» глобальные правила

## 6) Следующий шаг (CSS-революция)

1. Разнести page-css по `public/css/pages/*`
2. Выделить компоненты в отдельные файлы (buttons, chips, cards) — но **с namespace**:
   - `.tpl-...` или `.templates-...`
3. Добавить stylelint (опционально)
