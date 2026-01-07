import js from '@eslint/js';
import globals from 'globals';

export default [
  // =========================
  // 1) Глобальные игноры
  // =========================
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'archive/**',
      'docs/**',
      'public/**',
      'storage/**',
      'mvp-front/**',
      'info/**',
      '**/vendor/**',
      '**/*.min.js',
    ],
  },

  // =========================
  // 2) Базовые рекомендации ESLint
  // =========================
  js.configs.recommended,

  // =========================
  // 3) Основное приложение (src/**)
  // =========================
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  // =========================
  // 4) CLI / Dev-скрипты (scripts/**)
  // =========================
  {
    files: ['scripts/**/*.js', 'scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
