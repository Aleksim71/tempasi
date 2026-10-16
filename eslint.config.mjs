import globals from 'globals';

export default [
  {
    files: ['src/**/*.{js,cjs}', 'scripts/**/*.{js,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
