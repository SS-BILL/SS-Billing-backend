/**
 * Type-aware linting. The rules that matter here are the ones tied to money and
 * credentials: a floating promise in the billing keeper is a charge nobody
 * awaited, and an unchecked `any` is how an unvalidated merchant payload gets
 * treated as trusted input.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended',
  ],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/', '.eslintrc.js'],
  rules: {
    // Un-awaited work in a billing run silently loses charges and swallows
    // rejections. Non-negotiable.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-misused-promises': 'error',

    // Decorator-heavy Nest code needs interfaces to be declarable empty.
    '@typescript-eslint/no-empty-interface': 'off',

    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/interface-name-prefix': 'off',

    // Logging goes through Nest's Logger so it carries context and can be
    // shipped; a bare console.log bypasses that and can leak secrets.
    'no-console': 'error',
  },
  overrides: [
    {
      // Tests intentionally construct malformed input and stub partial
      // dependencies; the strict-typing rules fight that without adding safety.
      files: ['**/*.spec.ts'],
      rules: {
        // Mock factories are `async` to match the real signature they stand in
        // for, even when the stub body has nothing to await.
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
      },
    },
  ],
};
