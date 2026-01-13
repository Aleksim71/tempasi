'use strict';

const fs = require('fs');
const path = require('path');

function listTemplateSlugs() {
  // storage/templates лежит в корне проекта
  const root = process.cwd();
  const dir = path.join(root, 'storage', 'templates');

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    return items
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (e) {
    return [];
  }
}

function index(_req, res) {
  const slugs = listTemplateSlugs();

  // Главное: быстро и без ожиданий/DB — чтобы не “буксовало”
  res.status(200).send(`
    <!doctype html>
    <html><head><meta charset="utf-8"><title>Templates</title></head>
    <body>
      <h1>Templates</h1>
      <ul>
        ${slugs.map((s) => `<li><a href="/templates/${s}">${s}</a></li>`).join('')}
      </ul>
    </body></html>
  `);
}

module.exports = { index };
