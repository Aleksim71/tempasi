/**
 * Tempasi Core
 * Safe bootstrap — NO crashes if checkout is missing
 */

(function () {
  // protect from double load
  if (window.TempasiCoreLoaded) return;
  window.TempasiCoreLoaded = true;

  const Tempasi = {
    config: {
      checkout: null
    },

    init(cfg = {}) {
      if (cfg.checkout) {
        this.config.checkout = cfg.checkout;
        console.info('[Tempasi] checkout config loaded');
      } else {
        console.info('[Tempasi] checkout not configured (safe mode)');
      }
    },

    buy(slug) {
      if (!this.config.checkout) {
        console.warn('[Tempasi] buy disabled, checkout not ready:', slug);
        alert('Checkout will be available soon 🚧');
        return Promise.resolve(false);
      }
    },

    download(slug) {
      if (!slug) return;
      window.location.href = `/download/${slug}`;
    },

    preview(slug) {
      if (!slug) return;
      window.location.href = `/preview/${slug}`;
    }
  };

  window.Tempasi = Tempasi;

  /**
   * Global button handler
   */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const { action, slug } = btn.dataset;
    if (!slug || !action) return;

    e.preventDefault();

    try {
      if (action === 'buy') Tempasi.buy(slug);
      if (action === 'download') Tempasi.download(slug);
      if (action === 'preview') Tempasi.preview(slug);
    } catch (err) {
      console.error('[Tempasi] action error', err);
    }
  });

  console.info('[Tempasi] core loaded (safe mode)');
})();
