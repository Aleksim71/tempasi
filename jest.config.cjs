'use strict';

module.exports = {
  testEnvironment: 'node',

  // Forces NODE_ENV=test, drops PG* variables and refuses any database
  // whose name does not end in "_test" (see tests/setup/test-env.cjs).
  setupFiles: ['<rootDir>/tests/setup/test-env.cjs'],

  testMatch: [
    '<rootDir>/tests/**/*.test.cjs',
    '<rootDir>/tests/**/*.test.js',
  ],

  // важно для dynamic import() в тестах
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },

  verbose: true,
  detectOpenHandles: true,
};
