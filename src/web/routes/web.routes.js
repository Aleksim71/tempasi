// src/web/routes/web.routes.js
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { listTemplates } from '../services/templates.service.js';

function inlinePlaceholderSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset="1" stop-color="#0a0f18"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#g)"/>
  <rect x="60" y="60" width="1080" height="555" rx="28" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>
  <g fill="rgba(255,255,255,0.18)">
    <circle cx="120" cy="120" r="10"/>
    <circle cx="160" cy="120" r="10"/>
    <circle cx="200" cy="120" r="10"/>
  </g>
  <g fill="rgba(255,255,255,0.70)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" text-anchor="middle">
    <text x="600" y="340" font-size="34" font-weight="700">Preview not available</text>
    <text x="600" y="385" font-size="18" opacity="0.75">Missing preview file</text>
  </g>
</svg>`;
}

export function createWebRouter() {
  const r = express.Router();

  r.get('/', (req, res) => res.redirect('/templates'));

  /**
   * Preview image resolver (NO 404):
   * - serves real PNG if exists
   * - else serves placeholder SVG (file if exists, else inline)
   */
  r.get('/t/:slug/preview/preview.png', (req, res) => {
    const { slug } = req.params;

    const projectRoot = process.cwd();
    const realPng = path.join(projectRoot, 'storage', 'templates', slug, 'preview', 'preview.png');
    const placeholderSvg = path.join(projectRoot, 'public', 'img', 'preview-placeholder.svg');

    // Real png
    try {
      if (fs.existsSync(realPng)) {
        return res.sendFile(realPng);
      }
    } catch {
      // ignore and fallback
    }

    // Placeholder file (preferred)
    try {
      if (fs.existsSync(placeholderSvg)) {
        res.type('image/svg+xml');
        return res.sendFile(placeholderSvg);
      }
    } catch {
      // ignore and fallback
    }

    // Inline placeholder (last resort, no disk dependency, no errors)
    res.status(200).type('image/svg+xml').send(inlinePlaceholderSvg());
  });

  // Catalog
  r.get('/templates', async (req, res, next) => {
    try {
      res.set('X-Tempasi-ROUTE', 'web.routes.js:/templates:v2');

      const templates = await listTemplates();

      return res.render('pages/templates/index', {
        title: 'Templates',
        pageClass: 'page-templates',
        activePage: 'templates',
        templates,
        filters: {},
      });
    } catch (err) {
      return next(err);
    }
  });

  // Details (placeholder for now)
  r.get('/templates/:slug', (req, res) => {
    const { slug } = req.params;
    return res.render('pages/template-details', {
      pageTitle: slug,
      activePage: 'templates',
      slug,
      template: { slug, title: slug },
    });
  });

  // Preview (placeholder)
  r.get('/preview/:slug', (req, res) => {
    const { slug } = req.params;
    return res.status(200).send(`Preview placeholder for ${slug}`);
  });

  return r;
}
