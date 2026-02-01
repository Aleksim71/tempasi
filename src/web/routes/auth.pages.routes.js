// src/web/routes/auth.pages.routes.js
import express from 'express';

export function createAuthPagesRouter() {
  const router = express.Router();

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/cabinet');

    return res.status(200).render('pages/login', {
      title: 'Login',
      styles: ['/css/pages/auth.css'],
      bodyClass: 'auth', // опционально, но полезно для точечных правил
      hideHeader: false, // можно true если хочешь без шапки на auth
      form: { email: '', remember: false },
      fieldErrors: {},
      error: null,
    });
  });

  router.get('/register', (req, res) => {
    if (req.user) return res.redirect('/cabinet');

    return res.status(200).render('pages/register', {
      title: 'Create account',
      styles: ['/css/pages/auth.css'],
      bodyClass: 'auth',
      hideHeader: false,
      form: { name: '', email: '' },
      fieldErrors: {},
      error: null,
    });
  });

  return router;
}
