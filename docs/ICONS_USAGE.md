# Tempasi Icons — Variant A (Striped)

## 1) Подключение CSS

Добавь на страницу (или в общий layout):

```html
<link rel="stylesheet" href="/css/components/icons-tempasi.css" />
```

## 2) Использование (sprite)

Sprite лежит в `public/icons/tempasi-sprite.svg`.

Пример:

```html
<svg class="tp-icon tp-icon--md" aria-hidden="true">
  <use href="/icons/tempasi-sprite.svg#tp-action-preview" />
</svg>
```

## 3) Цвет

Иконки красятся через `currentColor`.

- белый (по умолчанию) — задается в `.tp-icon`
- золото — добавь класс `tp-icon--gold` или задай `color` на родителе

## 4) Доступные символы

- `tp-profile`, `tp-cart`
- `tp-zip-ready`, `tp-zip-not-ready`
- `tp-badge-pu`, `tp-badge-cu`, `tp-badge-el`, `tp-badge-ml`, `tp-badge-ex`
- `tp-action-preview`, `tp-action-buy`, `tp-action-download`
