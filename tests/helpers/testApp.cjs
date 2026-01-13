'use strict';

const request = require('supertest');

let cachedApp = null;

async function loadApp() {
  if (cachedApp) return cachedApp;

  if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST is not set');
  }

  // app.js использует DATABASE_URL → подменяем на тестовый
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

  const mod = await import('../../src/app.js');
  if (!mod || !mod.default) {
    throw new Error('Cannot import default export from src/app.js');
  }

  cachedApp = mod.default;
  return cachedApp;
}

async function makeAgent() {
  const app = await loadApp();
  return request.agent(app);
}

async function makeRequest() {
  const app = await loadApp();
  return request(app);
}

module.exports = {
  loadApp,
  makeAgent,
  makeRequest,
};
