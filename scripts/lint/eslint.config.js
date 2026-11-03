// 仓库统一的 ESLint flat config，由根目录 eslint.config.js 引用。
// 依赖装在本目录：typescript-eslint 需要 TS 的 JS API，而工作区使用不提供该 API 的原生 TS 7。
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/test-results/**',
  '**/playwright-report/**',
  'storage/**',
  'apps/api/storage/**',
  'apps/android/**',
  'apps/web-legacy/**',
  'tunnel-client-v0/**',
  'docs/**',
  '.worktrees/**',
  '.claude/**'
];

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/web-core/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['**/*.test.{js,mjs,ts,tsx}', '**/test/**', '**/e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.vitest } }
  },
  prettier
);
