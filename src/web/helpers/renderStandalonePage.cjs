// src/web/helpers/renderStandalonePage.cjs
//
// TEMPASI_STANDALONE_PAGE_LAYOUT (2026-08-15)
//
// Shared helper for small, one-off confirmation/status pages
// (payment success, restore-started, checkout-all summary, etc.)
// that previously built their own bare `<!doctype html>` string via
// res.send() — no site header/footer, just floating text on an
// otherwise blank page.
//
// This renders the SAME way every other page in the app already does
// (res.render() through the app's configured 'hbs' view engine +
// layouts/main layout), so header/footer/nav come along for free,
// with no new rendering mechanism to maintain.
'use strict';

function renderStandalonePage(req, res, { title, bodyHtml, bodyClass, statusCode, isAdmin }) {
  return res.status(statusCode || 200).render('pages/standalone-message', {
    title: title || 'Tempasi',
    bodyClass: bodyClass || 'standalone-page-body',
    bodyHtml: bodyHtml || '',
    // isAuthed/user/cartCount are already set globally on res.locals
    // by app.web.js's auth middleware — no need to compute here.
    isAdmin: Boolean(isAdmin),
  });
}

module.exports = { renderStandalonePage };
