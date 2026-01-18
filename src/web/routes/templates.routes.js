// src/web/routes/templates.routes.js
// Templates catalog page route: GET /templates

import { Router } from 'express';
import { listTemplates } from '../services/templates.service.js';

const router = Router();

router.get('/templates', async (req, res, next) => {
  try {
    // 🔎 DEBUG fingerprint: if you see this header in curl -i, this file is active
    res.set('X-Tempasi-CSSREV', 'templates.routes.js:v1');

    let templates = [];
    try {
      templates = await listTemplates();
    } catch {
      templates = [];
    }

    return res.render('pages/templates/index', {
      title: 'Templates__CSSREV_1',
      styles: ['/css/pages/catalog.css'],
      templates,
      pageClass: 'page-templates',
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
