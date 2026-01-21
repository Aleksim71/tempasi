/* public/js/core.js
   Tempasi Core — production-safe (never breaks pages)
*/

(() => {
  'use strict';

  // =============================
  // Small utils
  // =============================
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  function asString(v, fallback = '') {
    return typeof v === 'string' ? v : fallback;
  }

  // =============================
  // Checkout config discovery
  // =============================
  function findCheckoutPopupConfig() {
    // Priority:
    //  1) <script id="checkout-popup-config" type="application/json">{...}</script>
    //  2) <div data-checkout-popup-config='{"...": "..."}'></div>
    //  3) window.__CHECKOUT_POPUP_CONFIG__ = {...}
    // If not found — returns null (✅ no config is OK)
    try {
      const script = qs('#checkout-popup-config[type="application/json"]');
      if (script && script.textContent) {
        const cfg = safeJsonParse(script.textContent.trim());
        if (isRecord(cfg)) return cfg;
      }

      const node = qs('[data-checkout-popup-config]');
      if (node) {
        const raw = node.getAttribute('data-checkout-popup-config') || '';
        const cfg = safeJsonParse(raw.trim());
        if (isRecord(cfg)) return cfg;
      }

      const w = /** @type {any} */ (window);
      if (isRecord(w.__CHECKOUT_POPUP_CONFIG__)) return w.__CHECKOUT_POPUP_CONFIG__;

      return null; // ✅ no config is OK
    } catch {
      return null; // ✅ no config is OK
    }
  }

  // =============================
  // Modal (very lightweight)
  // =============================
  function ensureModalShell() {
    let overlay = qs('#tps-checkout-overlay');
    let modal = qs('#tps-checkout-modal');

    if (overlay && modal) return { overlay, modal };

    overlay = document.createElement('div');
    overlay.id = 'tps-checkout-overlay';
    overlay.setAttribute('data-tps', 'overlay');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,0.55)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'z-index:9999'
    ].join(';');

    modal = document.createElement('div');
    modal.id = 'tps-checkout-modal';
    modal.setAttribute('data-tps', 'modal');
    modal.style.cssText = [
      'width:min(520px, calc(100vw - 32px))',
      'background:#111',
      'color:#fff',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:16px',
      'box-shadow:0 20px 70px rgba(0,0,0,0.5)',
      'padding:16px'
    ].join(';');

    overlay.appendChild(modal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideModal();
    });

    document.body.appendChild(overlay);
    return { overlay, modal };
  }

  function showModal(html) {
    const { overlay, modal } = ensureModalShell();
    modal.innerHTML = html;
    overlay.style.display = 'flex';
  }

  function hideModal() {
    const overlay = qs('#tps-checkout-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // =============================
  // Checkout flow (safe)
  // =============================
  async function createOrderAndRedirect(cfg, payload) {
    const endpoint = asString(cfg.createOrderEndpoint, '');
    if (!endpoint) return false;

    const method = asString(cfg.method, 'POST').toUpperCase();
    const headers = { 'Content-Type': 'application/json' };

    const res = await fetch(endpoint, {
      method,
      headers,
      body: JSON.stringify(payload || {})
    });

    if (!res.ok) return false;

    const data = await res.json().catch(() => null);
    if (!isRecord(data)) return false;

    const checkoutUrl =
      asString(data.checkout_url, '') ||
      asString(data.checkoutUrl, '') ||
      asString(data.url, '');

    if (!checkoutUrl) return false;

    window.location.assign(checkoutUrl);
    return true;
  }

  function buildDefaultPopupHtml({ title, subtitle }) {
    const t = title || 'Checkout';
    const s = subtitle || 'Preparing your order…';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:16px;">${escapeHtml(t)}</div>
        <button type="button" data-tps-close
          style="appearance:none;border:0;background:transparent;color:#fff;opacity:.7;cursor:pointer;font-size:18px;line-height:1;">
          ×
        </button>
      </div>
      <div style="opacity:.85;font-size:13px;margin-bottom:12px;">${escapeHtml(s)}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" data-tps-cancel
          style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:transparent;color:#fff;cursor:pointer;">
          Cancel
        </button>
        <button type="button" data-tps-confirm
          style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:#2b6cff;color:#fff;cursor:pointer;">
          Continue
        </button>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function attachModalHandlers(onConfirm) {
    const overlay = qs('#tps-checkout-overlay');
    if (!overlay) return;

    const close = qs('[data-tps-close]', overlay);
    const cancel = qs('[data-tps-cancel]', overlay);
    const confirm = qs('[data-tps-confirm]', overlay);

    const closeFn = () => hideModal();

    close && close.addEventListener('click', closeFn, { once: true });
    cancel && cancel.addEventListener('click', closeFn, { once: true });

    if (confirm) {
      confirm.addEventListener(
        'click',
        async () => {
          try {
            confirm.disabled = true;
            confirm.textContent = 'Working…';
            await onConfirm();
          } finally {
            hideModal();
          }
        },
        { once: true }
      );
    }
  }

  function bindCheckoutButtons(cfg) {
    // Bind selector can be customized; fall back to common attributes/classes
    const sel = asString(
      cfg.buySelector,
      '[data-action="buy"], [data-buy], a[data-buy], button[data-buy], .js-buy'
    );

    const buttons = qsa(sel);
    if (!buttons.length) return;

    for (const el of buttons) {
      el.addEventListener('click', async (e) => {
        try {
          // Prevent normal navigation if we are handling checkout
          e.preventDefault();

          // If config has no endpoint — do nothing safely
          const endpoint = asString(cfg.createOrderEndpoint, '');
          if (!endpoint) return; // ✅ no config is OK

          const templateSlug =
            asString(el.getAttribute('data-template'), '') ||
            asString(el.getAttribute('data-slug'), '');

          const license =
            asString(el.getAttribute('data-license'), '') ||
            asString(el.getAttribute('data-tier'), '');

          const payload = {
            template_slug: templateSlug,
            license
          };

          // Optional popup; if disabled, go straight to order creation
          const usePopup = cfg.popup === false ? false : true;

          if (!usePopup) {
            // ✅ core never breaks the page
            await createOrderAndRedirect(cfg, payload).catch(() => false);
            return;
          }

          showModal(
            buildDefaultPopupHtml({
              title: asString(cfg.popupTitle, 'Checkout'),
              subtitle: asString(cfg.popupSubtitle, 'Continue to payment?')
            })
          );

          attachModalHandlers(async () => {
            // ✅ core never breaks the page
            await createOrderAndRedirect(cfg, payload).catch(() => false);
          });
        } catch {
          // ✅ core never breaks the page
        }
      });
    }
  }

  function initCheckout() {
    try {
      const cfg = findCheckoutPopupConfig();
      if (!cfg) return; // ✅ no config is OK

      // If config is present but malformed — still do not crash
      if (!isRecord(cfg)) return;

      bindCheckoutButtons(cfg);
    } catch {
      // ✅ core never breaks the page
    }
  }

  // =============================
  // Boot
  // =============================
  function boot() {
    try {
      initCheckout();
    } catch {
      // ✅ core never breaks the page
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
