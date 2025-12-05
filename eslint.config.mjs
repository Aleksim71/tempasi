import js from '@eslint/js';
import globals from 'globals';

export default [
  // 1) Глобальные игноры — применяются до всего остального
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'mvp-front/**',
      'info/**',
      '**/vendor/**',
      '**/*.min.js',
    ],
  },

  // 2) Базовый конфиг
  js.configs.recommended,

  // 3) Наши настройки для src/**
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
];
