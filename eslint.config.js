import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/', 'node_modules/', 'tests/fixtures/'],
  },
  // ESLint recommended rules
  js.configs.recommended,
  // TypeScript ESLint recommended (includes parser setup, eslint-recommended overrides, and TS rules)
  ...tsPlugin.configs['flat/recommended'],
  // Project-specific overrides
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
