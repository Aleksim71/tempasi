import globals from 'globals';

export default [
  // ...твои текущие блоки

  {
    files: ['src/**/*.{js,cjs}', 'scripts/**/*.{js,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
