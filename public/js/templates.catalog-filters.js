/* public/js/templates.catalog-filters.js
 *
 * TEMPASI_CATALOG_PAGINATION (2026-08-13)
 *
 * Was: reactive client-side filtering that show/hid already-rendered
 * SSR cards in the DOM (see git history for the old version). That
 * was fine while the catalog was small, but GET /templates now does
 * real server-side filtering + pagination (see templates.repo.js
 * selectTemplatesForCatalogPage and templates.routes.js), so this
 * script's job changed:
 *
 *   - Category checkboxes / Access radio / "Per page" select:
 *     auto-submit the form on change (classic full-page GET reload,
 *     each toggle = one request).
 *   - Search (q) / Price (priceMax): NOT auto-submitted on every
 *     keystroke/drag — only on Apply click or Enter (native form
 *     behavior), to avoid a page reload per character typed or per
 *     pixel dragged.
 *   - Price range <-> number field: kept in sync with each other
 *     visually (client-side only, no request), and the hidden
 *     `priceActive` field is set to "1" the first time the user
 *     actually touches either one — mirrors the previous behavior of
 *     not treating the slider's resting default value as an implied
 *     active filter until the user interacts with it. The server
 *     reads priceActive, not just the presence of priceMax, to decide
 *     whether to apply the price cap at all.
 *
 * No DOM show/hide, no URL sync via history.replaceState — the URL is
 * simply whatever the browser navigated to on submit.
 */

(function () {
  function qs(root, sel) {
    return root.querySelector(sel);
  }

  function qsa(root, sel) {
    return Array.from(root.querySelectorAll(sel));
  }

  function debounce(fn, wait) {
    let t = null;
    return function debounced(...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function syncPriceInputs(range, number, value) {
    const v = Math.max(0, Math.min(1000, Number(value) || 0));
    if (range) range.value = String(v);
    if (number) number.value = String(v);
    return v;
  }

  function init() {
    const form = document.querySelector('.templates-filters');
    if (!form) return;

    const submitForm = debounce(() => form.submit(), 0);

    // Category checkboxes — auto-submit, discrete action.
    for (const box of qsa(form, 'input[name="cat"]')) {
      box.addEventListener('change', submitForm);
    }

    // Access radios — auto-submit, discrete action.
    for (const radio of qsa(form, 'input[name="access"]')) {
      radio.addEventListener('change', submitForm);
    }

    // Per-page select — auto-submit. Deliberately no `page` field in
    // this form, so changing page size always lands back on page 1.
    const pageSizeSelect = qs(form, 'select[name="pageSize"]');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', submitForm);
    }

    // Price range + number field: visual sync only, mark the filter
    // "active" on first touch, but do NOT submit on every drag/tick —
    // that's Apply's job (or Enter, for text-like inputs).
    const priceRange = qs(form, 'input[name="priceMax"]');
    const priceNumber = qs(form, 'input[name="priceMaxN"]');
    const priceActiveFlag = qs(form, '#priceActiveFlag');

    function markPriceActive() {
      if (priceActiveFlag) priceActiveFlag.value = '1';
    }

    if (priceRange) {
      priceRange.addEventListener('input', () => {
        markPriceActive();
        syncPriceInputs(priceRange, priceNumber, priceRange.value);
      });
    }

    if (priceNumber) {
      priceNumber.addEventListener('input', () => {
        if (priceNumber.value === '') return; // let them clear the field without snapping to 0
        markPriceActive();
        syncPriceInputs(priceRange, priceNumber, priceNumber.value);
      });
    }

    // Search (q): plain native Enter-to-submit / Apply button. No
    // listener needed — the browser already submits a <form> when
    // Enter is pressed inside a text/search input.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
