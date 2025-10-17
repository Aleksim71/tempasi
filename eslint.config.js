// eslint.config.js
import js from "@eslint/js";
import globals from "globals";

export default [
  // 1) Глобальные игноры: не линтим чужие/минифицированные файлы
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "info/**",
      "build/**",
      "coverage/**",
      // вся папка с шаблоном/ассетами фронта:
      "info/mvp-front/**",
      // на всякий:
      "**/*.min.js",
      "**/*.min.css",
    ],
  },

  // 2) Базовая конфигурация для твоего кода (src, tests)
  js.configs.recommended,
  {
    files: ["**/*.js"],
    ignores: ["node_modules/**"], // дублируем для секции files
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node, // твой бэкенд
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "prefer-const": "error",
      semi: ["error", "always"],
      quotes: ["error", "single"],
      eqeqeq: ["error", "always"],
    },
  },
];
