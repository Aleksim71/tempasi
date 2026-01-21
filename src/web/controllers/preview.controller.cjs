'use strict';

function show(req, res, next) {
  try {
    const slug = String(req.params.slug || '');
    return res.status(200).send(`Preview OK (stub): ${slug}`);
  } catch (e) {
    return next(e);
  }
}

module.exports = { show };
