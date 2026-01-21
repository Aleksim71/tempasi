import express from 'express';

const router = express.Router();

router.get('/checkout/success', (req, res) => {
  const { slug } = req.query;

  return res.render('pages/checkout/success', {
    title: 'Checkout success',
    slug,

    pageClass: 'page-checkout-success',

    pageCss: ['/css/checkout.success.css'],

    pageJs: ['/js/checkout.success.js'],
  });
});

export default router;
