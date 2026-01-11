'use strict';

const ordersService = require('./orders.service.cjs');

function toStr(v) {
  return v == null ? '' : String(v);
}

function isHtmlFormRequest(req) {
  const accept = toStr(req.headers.accept).toLowerCase();
  const contentType = toStr(req.headers['content-type']).toLowerCase();

  // Typical browser form submit:
  const isUrlEncoded = contentType.includes('application/x-www-form-urlencoded');
  const isMultipart = contentType.includes('multipart/form-data');

  // Browser navigation hints:
  const secFetchDest = toStr(req.headers['sec-fetch-dest']).toLowerCase(); // "document"
  const secFetchMode = toStr(req.headers['sec-fetch-mode']).toLowerCase(); // "navigate"
  const secFetchUser = toStr(req.headers['sec-fetch-user']).toLowerCase(); // "?1"

  const looksLikeNavigate =
    secFetchDest === 'document' ||
    secFetchMode === 'navigate' ||
    secFetchUser === '?1';

  // Explicit html accept:
  const wantsHtml =
    accept.includes('text/html') || accept.includes('application/xhtml+xml');

  // If it's a form submit, treat as HTML flow even if accept is "*/*"
  return (isUrlEncoded || isMultipart) && (wantsHtml || looksLikeNavigate || accept.includes('*/*'));
}

// POST /api/orders/:slug/buy
async function buy(req, res, next) {
  try {
    const slug = toStr(req.params && req.params.slug).trim();
    if (!slug) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'slug is required' },
      });
    }

    const userId = ordersService.getUserIdFromReq(req);

    const dealType = toStr(req.body && req.body.dealType).trim();
    const amount = req.body && req.body.amount;
    const currency = toStr(req.body && req.body.currency).trim();

    const result = await ordersService.createPendingOrder({
      req,
      slug,
      userId,
      dealType,
      amount,
      currency,
    });

    if (isHtmlFormRequest(req)) {
      return res.redirect(303, result.checkoutUrl);
    }

    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  buy,
};
