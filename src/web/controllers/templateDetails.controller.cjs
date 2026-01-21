'use strict';

function show(req, res, next) {
  try {
    const slug = String(req.params.slug || '');
    return res.status(200).send(`Template details OK (stub): ${slug}`);
  } catch (e) {
    return next(e);
  }
}

module.exports = { show };
