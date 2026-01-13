'use strict';

const express = require('express');

function profileRoutes() {
  const router = express.Router();

  // SSR страница профиля (минимальная заглушка)
  router.get('/', (req, res) => {
    // если у тебя есть реальный шаблон — подключишь позже
    return res.status(200).send('Profile page');
  });

  return router;
}

module.exports = { profileRoutes };
