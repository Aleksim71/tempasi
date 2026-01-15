/* public/js/templates.filters.js
 *
 * Filters for /templates page:
 * - Search by title/slug
 * - ZIP: ready | not_ready | any
 * - License: any | free | pu | cu | el | ml | ex
 * - Sync with query string (no reload)
 */

(function () {
  function qs(root, sel) {
    return root.querySelector(sel);
  }

  function qsa(root, sel) {
    return Array.from(root.querySelectorAll(sel));
  }

  function norm(v) {
    return String(v || '').trim().toLowerCase();
  }

  function getParam(params, key, fallback) {
    const v = params.get(key);
    if (v === null || v === undefined || v === '') return fallback;
    return v;
  }

  function setActiveChip(groupSel, value) {
    const chips = qsa(document, `[data-filter-chip="${groupSel}"]`);
    for (const b of chips) {
      const isActive = b.getAttribute('data-value') === value;
      b.classList.toggle('chip--active', isActive);
    }
  }

  function applyFilters(state) {
    const cards = qsa(document, '[data-template-card]');
    let visible = 0;

    for (const card of cards) {
      const title = norm(card.getAttribute('data-title'));
      const slug = norm(card.getAttribute('data-slug'));
      const zip = norm(card.getAttribute('data-zip')); // ready|not_ready
      const license = norm(card.getAttribute('data-license')); // free|pu|...

      let ok = true;

      // q
      if (state.q) {
        const q = norm(state.q);
        ok = ok && (title.includes(q) || slug.includes(q));
      }

      // zip
      if (state.zip !== 'any') {
        ok = ok && zip === state.zip;
      }

      // license
      if (state.license !== 'any') {
        ok = ok && license === state.license;
      }

      card.style.display = ok ? '' : 'none';
      if (ok) visible += 1;
    }

    const total = cards.length;
    const elCount = qs(document, '[data-templates-count]');
    if (elCount) elCount.textContent = `${visible}/${total}`;
  }

  function readStateFromUrl() {
    const params = new URLSearchParams(window.location.search);

    // note: you used zip=any&license=any&q=... in the URL already
    const q = getParam(params, 'q', '');
    const zip = norm(getParam(params, 'zip', 'any'));
    const license = norm(getParam(params, 'license', 'any'));

    // normalize expected values
    const zipOk = zip === 'ready' || zip === 'not_ready' || zip === 'any' ? zip : 'any';
    const licOk =
      license === 'any' ||
      license === 'free' ||
      license === 'pu' ||
      license === 'cu' ||
      license === 'el' ||
      license === 'ml' ||
      license === 'ex'
        ? license
        : 'any';

    return { q, zip: zipOk, license: licOk };
  }

  function writeStateToUrl(state) {
    const params = new URLSearchParams(window.location.search);

    if (state.q) params.set('q', state.q);
    else params.delete('q');

    params.set('zip', state.zip || 'any');
    params.set('license', state.license || 'any');

    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', next);
  }

  function bindUI(state) {
    const search = qs(document, '[data-filter="q"]');

    if (search) {
      search.value = state.q || '';
      search.addEventListener('input', function () {
        state.q = search.value || '';
        writeStateToUrl(state);
        applyFilters(state);
      });
    }

    // zip chips
    for (const b of qsa(document, '[data-filter-chip="zip"]')) {
      b.addEventListener('click', function () {
        const v = norm(b.getAttribute('data-value'));
        state.zip = v || 'any';
        setActiveChip('zip', state.zip);
        writeStateToUrl(state);
        applyFilters(state);
      });
    }

    // license chips
    for (const b of qsa(document, '[data-filter-chip="license"]')) {
      b.addEventListener('click', function () {
        const v = norm(b.getAttribute('data-value'));
        state.license = v || 'any';
        setActiveChip('license', state.license);
        writeStateToUrl(state);
        applyFilters(state);
      });
    }

    const reset = qs(document, '[data-filter-reset]');
    if (reset) {
      reset.addEventListener('click', function () {
        state.q = '';
        state.zip = 'any';
        state.license = 'any';

        if (search) search.value = '';
        setActiveChip('zip', 'any');
        setActiveChip('license', 'any');

        writeStateToUrl(state);
        applyFilters(state);
      });
    }
  }

  function init() {
    // If this script is loaded on another page — do nothing.
    if (!document.querySelector('[data-templates-filters]')) return;

    const state = readStateFromUrl();

    // Sync chips UI
    setActiveChip('zip', state.zip);
    setActiveChip('license', state.license);

    bindUI(state);
    applyFilters(state);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
