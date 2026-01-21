# Tempasi Icons — Variant A (Striped / Negative)

Included (MVP pack):

- `profile-striped.svg`
- `cart-striped.svg`
- `status-zip-ready-striped.svg`
- `status-zip-not-ready-striped.svg`
- `badge-PU-striped.svg`

## Usage (inline)

```html
<!-- Default (white 85%) -->
<span class="tp-icon" style="color: rgba(255,255,255,.85)">
  <!-- paste SVG here -->
</span>

<!-- Hover / active (gold) -->
<span class="tp-icon is-active" style="color: var(--gold)">
  <!-- paste SVG here -->
</span>
```

## Notes

- Icons use `currentColor`, so color is controlled by CSS.
- The symbol is negative space (cutout) via SVG `mask`.
- ViewBox is `64x48` for consistent scaling across UI.
