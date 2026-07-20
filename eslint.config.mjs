import { defineConfig } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // Never lint build output, deps, or embedded git worktrees (separate checkouts that
    // carry their own history — linting them reports thousands of irrelevant errors).
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      '.worktrees/**',
      '.claude/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
])
