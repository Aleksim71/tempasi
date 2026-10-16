// path: tests/helpers/closeDbAfterTest.cjs
/* eslint-env node */
'use strict';

function pushCloser(closers, owner, methodName) {
  if (!owner || typeof owner[methodName] !== 'function') return;

  closers.push(async () => {
    await owner[methodName]();
  });
}

function collectClosers(root, seenObjects = new Set(), closers = []) {
  if (!root || typeof root !== 'object') return closers;
  if (seenObjects.has(root)) return closers;

  seenObjects.add(root);

  pushCloser(closers, root, 'close');
  pushCloser(closers, root, 'end');

  for (const key of ['pool', 'db', 'client', 'default', 'database']) {
    if (root[key] && typeof root[key] === 'object') {
      collectClosers(root[key], seenObjects, closers);
    }
  }

  return closers;
}

function tryRequireDefaultDb() {
  try {
    return require('../../src/config/db.cjs');
  } catch (_) {
    return null;
  }
}

async function closeDbAfterTest(...roots) {
  const effectiveRoots = roots.length ? roots : [tryRequireDefaultDb()];
  const closers = [];

  for (const root of effectiveRoots) {
    collectClosers(root, new Set(), closers);
  }

  const errors = [];

  for (const close of closers) {
    try {
      await close();
      return;
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length && process.env.TEMPASI_STRICT_DB_CLOSE === '1') {
    throw errors[errors.length - 1];
  }
}

module.exports = {
  closeDbAfterTest,
  closeDbLike: closeDbAfterTest,
};
