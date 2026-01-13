'use strict';

const ordersService = require('./orders.service.cjs');

async function buy(req, res) {
  try {
    const userId = req.user.id;
    const templateSlug = req.params.slug;

    const order = await ordersService.createPendingOrder({
      userId,
      templateSlug,
      payload: req.body || {},
    });

    return res.status(201).json({ order_id: order.id });
  } catch (e) {
    return res.status(500).json({
      error: {
        code: 'BUY_FAILED',
        message: e && e.message ? e.message : 'Buy failed',
      },
    });
  }
}

module.exports = { buy };
