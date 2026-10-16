/* public/js/confirm-modal.js
 *
 * TEMPASI_CUSTOM_CONFIRM_MODAL (2026-08-15)
 *
 * Replaces native window.confirm()/window.prompt() with a styled
 * modal matching the rest of the site (same visual language as the
 * Rent modal on the catalog page — dark panel, rounded corners,
 * backdrop). Loaded globally (src/web/views/layouts/main.hbs), so
 * it's available on every page without per-page opt-in.
 *
 * Exposes three globals:
 *   window.tempasiConfirm({ title, message, confirmLabel, danger })
 *     -> Promise<boolean>
 *   window.tempasiPrompt({ title, message, inputPlaceholder, confirmLabel, danger })
 *     -> Promise<string|null>
 *   window.tempasiAlert({ title, message, confirmLabel, danger })
 *     -> Promise<void>
 *     One-button "OK" dialog for plain informational/error messages —
 *     no Cancel, no input. Added 2026-08-15 so server-rendered "?cart=
 *     CODE" style banners (e.g. "You can't buy or rent your own
 *     template") can use the same modal pattern as everything else on
 *     the site instead of an inline page banner.
 *
 * tempasiPrompt() resolves with the typed string on confirm, or null
 * on cancel/Escape — the same contract as window.prompt(), so
 * existing "typed !== expectedValue" comparisons at call sites don't
 * need to change, only the call itself (and awaiting it).
 */
(function () {
  var modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.className = 'tcm-overlay';
    modalEl.hidden = true;
    modalEl.innerHTML =
      '<div class="tcm-backdrop" data-tcm-close></div>' +
      '<div class="tcm-panel" role="dialog" aria-modal="true" aria-labelledby="tcmTitle">' +
      '<button type="button" class="tcm-close" data-tcm-close aria-label="Close">&times;</button>' +
      '<h3 id="tcmTitle" class="tcm-title"></h3>' +
      '<p class="tcm-message"></p>' +
      '<div class="tcm-input-wrap" data-tcm-input-wrap hidden>' +
      '<input type="text" class="tcm-input" autocomplete="off" />' +
      '</div>' +
      '<div class="tcm-actions">' +
      '<button type="button" class="c-btn" data-tcm-cancel>Cancel</button>' +
      '<button type="button" class="c-btn c-btn--primary" data-tcm-confirm></button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function open(opts) {
    var withInput = Boolean(opts.withInput);
    var hideCancel = Boolean(opts.hideCancel);

    return new Promise(function (resolve) {
      var el = ensureModal();
      var titleEl = el.querySelector('#tcmTitle');
      var messageEl = el.querySelector('.tcm-message');
      var inputWrap = el.querySelector('[data-tcm-input-wrap]');
      var input = el.querySelector('.tcm-input');
      var confirmBtn = el.querySelector('[data-tcm-confirm]');
      var cancelBtn = el.querySelector('[data-tcm-cancel]');
      var closeEls = el.querySelectorAll('[data-tcm-close]');

      titleEl.textContent = opts.title || '';
      messageEl.textContent = opts.message || '';
      confirmBtn.textContent = opts.confirmLabel || (hideCancel ? 'OK' : 'Confirm');
      confirmBtn.className = 'c-btn ' + (opts.danger ? 'c-btn--danger' : 'c-btn--primary');
      cancelBtn.hidden = hideCancel;

      if (withInput) {
        inputWrap.hidden = false;
        input.value = '';
        input.placeholder = opts.inputPlaceholder || '';
      } else {
        inputWrap.hidden = true;
      }

      function cleanup(result) {
        el.hidden = true;
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        for (var i = 0; i < closeEls.length; i++) {
          closeEls[i].removeEventListener('click', onCancel);
        }
        document.removeEventListener('keydown', onKeydown);
        resolve(result);
      }

      function onConfirm() {
        cleanup(withInput ? input.value : true);
      }

      function onCancel() {
        cleanup(withInput ? null : false);
      }

      function onKeydown(e) {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && withInput) onConfirm();
      }

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      for (var j = 0; j < closeEls.length; j++) {
        closeEls[j].addEventListener('click', onCancel);
      }
      document.addEventListener('keydown', onKeydown);

      el.hidden = false;
      if (withInput) {
        input.focus();
      } else {
        confirmBtn.focus();
      }
    });
  }

  window.tempasiConfirm = function (opts) {
    return open(Object.assign({}, opts || {}, { withInput: false }));
  };

  window.tempasiPrompt = function (opts) {
    return open(Object.assign({}, opts || {}, { withInput: true }));
  };

  window.tempasiAlert = function (opts) {
    return open(Object.assign({}, opts || {}, { withInput: false, hideCancel: true }));
  };
})();
