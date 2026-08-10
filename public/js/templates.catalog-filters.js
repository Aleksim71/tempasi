/* public/js/templates.catalog-filters.js
 *
 * TEMPASI_CATALOG_REACTIVE_FILTERS (2026-08-10)
 *
 * Reactive (no "Apply" click needed) client-side filtering for the
 * /templates catalog sidebar: category checkboxes, price range, and
 * access (buy-only vs buy+rent) radio.
 *
 * Why client-side and not server-side:
 * The sidebar <form method="get" action="/templates"> already submits
 * cat/priceMax/access/q as real query params, but GET /templates in
 * templates.routes.js never reads req.query for any of them — every
 * request (Apply or not) returns the same full unfiltered list, and
 * the "0/0" counter was static markup that nothing ever updated.
 * This script filters the already-rendered SSR cards in the DOM
 * instead, which is enough while the catalog is small. If the catalog
 * grows into the thousands, this should be revisited in favor of real
 * server-side filtering + pagination.
 *
 * The Apply button and Reset link keep working as a plain page
 * navigation fallback for no-JS clients (server still just returns
 * the unfiltered list in that case, same as before this patch).
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

  function readState(form, priceFilterActive) {
    const catBoxes = qsa(form, 'input[name="cat"]:checked');
    const accessRadio = qs(form, 'input[name="access"]:checked');
    const priceRange = qs(form, 'input[name="priceMax"]');
    const searchInput = qs(form, 'input[name="q"]');

    return {
      q: (searchInput && searchInput.value.trim().toLowerCase()) || '',
      cats: catBoxes.map((b) => b.value),
      access: accessRadio ? accessRadio.value : '', // '' | 'buy' | 'rent'
      // Only apply the price cap once the user has actually touched
      // the slider/number field. The range input ships with a
      // non-1000 default value (e.g. 250) purely as a visual thumb
      // position, not as an implied active filter — treating it as
      // active on page load silently hid any card priced above that
      // default before the user ever interacted with anything.
      priceMax: priceFilterActive && priceRange ? Number(priceRange.value) : null,
    };
  }

  function cardMatches(card, state) {
    if (state.q) {
      const slug = String(card.getAttribute('data-template-slug') || '').toLowerCase();
      const title = String(
        card.querySelector('.tcard__title')?.textContent || '',
      ).toLowerCase();
      if (!slug.includes(state.q) && !title.includes(state.q)) return false;
    }

    if (state.cats.length) {
      const cardCat = card.getAttribute('data-category') || '';
      if (!state.cats.includes(cardCat)) return false;
    }

    if (state.access === 'buy') {
      // "Buy only" — exclude templates that also offer rent.
      if (card.getAttribute('data-has-rent') === '1') return false;
    } else if (state.access === 'rent') {
      // "Buy + Rent" — only templates that offer rent.
      if (card.getAttribute('data-has-rent') !== '1') return false;
    }

    if (state.priceMax !== null && !Number.isNaN(state.priceMax)) {
      const price = Number(card.getAttribute('data-price'));
      // Cards without a parseable buy price are not excluded by the
      // price filter (nothing to compare against).
      if (Number.isFinite(price) && price > state.priceMax) return false;
    }

    return true;
  }

  function applyFilters(form, grid, countEl, priceFilterActive) {
    const state = readState(form, priceFilterActive);
    const cards = qsa(grid, '[data-template-card]');
    let visible = 0;

    for (const card of cards) {
      const ok = cardMatches(card, state);
      // Use setProperty(..., 'important') rather than plain
      // card.style.display: some view modes (e.g.
      // .templates-grid--maxi .tcard) set `display: grid !important`
      // in the stylesheet, which silently wins over a plain inline
      // style and makes filtering look like it does nothing in that
      // view. An inline !important always outranks a stylesheet
      // !important, so this is the one reliable way to actually hide
      // a card regardless of which grid/list view mode is active.
      if (ok) {
        card.style.removeProperty('display');
      } else {
        card.style.setProperty('display', 'none', 'important');
      }
      if (ok) visible += 1;
    }

    if (countEl) countEl.textContent = `${visible}/${cards.length}`;
    syncUrl(state);
  }

  function syncUrl(state) {
    const params = new URLSearchParams(window.location.search);

    if (state.q) params.set('q', state.q);
    else params.delete('q');

    params.delete('cat');
    for (const c of state.cats) params.append('cat', c);

    if (state.access) params.set('access', state.access);
    else params.delete('access');

    if (state.priceMax !== null && !Number.isNaN(state.priceMax)) {
      params.set('priceMax', String(state.priceMax));
    } else {
      params.delete('priceMax');
    }

    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState(null, '', next);
  }

  function syncPriceInputs(range, number, value) {
    const v = Math.max(0, Math.min(1000, Number(value) || 0));
    if (range) range.value = String(v);
    if (number) number.value = String(v);
    return v;
  }

  function init() {
    const form = document.querySelector('.templates-filters');
    const grid = document.getElementById('templatesView');
    const countEl = document.querySelector('[data-js="templates-count"]');

    if (!form || !grid) return;

    // Becomes true the first time the user touches the price slider
    // or number field — see the comment in readState() for why.
    let priceFilterActive = false;

    const run = () => applyFilters(form, grid, countEl, priceFilterActive);
    const runDebounced = debounce(run, 120);

    // Category checkboxes — instant.
    for (const box of qsa(form, 'input[name="cat"]')) {
      box.addEventListener('change', run);
    }

    // Access radios — instant.
    for (const radio of qsa(form, 'input[name="access"]')) {
      radio.addEventListener('change', run);
    }

    // Search — light debounce while typing.
    const searchInput = qs(form, 'input[name="q"]');
    if (searchInput) {
      searchInput.addEventListener('input', runDebounced);
    }

    // Price range + number field — keep them in sync with each other,
    // then filter. Debounced so dragging the slider doesn't thrash.
    const priceRange = qs(form, 'input[name="priceMax"]');
    const priceNumber = qs(form, 'input[name="priceMaxN"]');

    if (priceRange) {
      priceRange.addEventListener('input', () => {
        priceFilterActive = true;
        syncPriceInputs(priceRange, priceNumber, priceRange.value);
        runDebounced();
      });
    }

    if (priceNumber) {
      priceNumber.addEventListener('input', () => {
        if (priceNumber.value === '') return; // let them clear the field without snapping to 0
        priceFilterActive = true;
        syncPriceInputs(priceRange, priceNumber, priceNumber.value);
        runDebounced();
      });
    }

    // JS is active: filtering is already live, so a form submit would
    // only cause a redundant full-page reload back to the same
    // (server-side unfiltered) list. Prevent it. Reset stays a plain
    // <a href="/templates">, not part of this submit handler.
    form.addEventListener('submit', (e) => e.preventDefault());

    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
