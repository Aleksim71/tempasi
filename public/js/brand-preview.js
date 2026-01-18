// public/js/brand-preview.js
(function () {
  const KEY = 'tempasi_brand_palette';
  const root = document.documentElement;

  function apply(val) {
    if (!val) return;
    root.dataset.brand = val;
  }

  // load saved
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) apply(saved);
  } catch {}

  // wire buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-brand-pick]');
    if (!btn) return;

    const val = btn.getAttribute('data-brand-pick') || '';
    apply(val);

    try {
      localStorage.setItem(KEY, val);
    } catch {}

    // visual active state
    const group = btn.closest('[data-brand-group]');
    if (group) {
      group.querySelectorAll('[data-brand-pick]').forEach((b) => b.classList.remove('chip--active'));
      btn.classList.add('chip--active');
    }
  });
})();
