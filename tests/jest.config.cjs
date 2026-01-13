'use strict';

module.exports = {
  testEnvironment: 'node',

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
