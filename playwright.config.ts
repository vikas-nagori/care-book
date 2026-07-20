import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

// Load the committed local-stack env (URL + well-known local keys) for the seed harness and
// the app under test. See .env.e2e — these are non-secret local-development keys.
dotenv.config({ path: '.env.e2e', override: true })

import { ADMIN, STAFF, PLATFORM } from './e2e/support/accounts'

const CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  // Specs run in parallel across projects; the setup project seeds + authenticates first.
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['html', { open: 'never' }], ['github']] : [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  // Build once with the local-stack env, then serve the production build. Building inside the
  // webServer command keeps a single entrypoint; reuseExistingServer skips it locally when a
  // server is already up. Timeout covers a cold `next build`.
  webServer: {
    command: 'npm run build:e2e && npm run start:e2e',
    url: 'http://localhost:3000',
    reuseExistingServer: !CI,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },

    // Clinic admin — full access incl. Billing. Runs shared + admin-only specs.
    {
      name: 'admin-desktop',
      dependencies: ['setup'],
      testMatch: ['shared/**/*.spec.ts', 'admin/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], storageState: ADMIN.storageState },
    },
    {
      name: 'admin-mobile',
      dependencies: ['setup'],
      testMatch: ['shared/**/*.spec.ts', 'admin/**/*.spec.ts'],
      use: { ...devices['Pixel 5'], storageState: ADMIN.storageState },
    },

    // Clinic staff — no Billing, narrowed appointment visibility. Runs shared + staff specs.
    {
      name: 'staff-desktop',
      dependencies: ['setup'],
      testMatch: ['shared/**/*.spec.ts', 'staff/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], storageState: STAFF.storageState },
    },
    {
      name: 'staff-mobile',
      dependencies: ['setup'],
      testMatch: ['shared/**/*.spec.ts', 'staff/**/*.spec.ts'],
      use: { ...devices['Pixel 5'], storageState: STAFF.storageState },
    },

    // Platform super-admin console (desktop only).
    {
      name: 'platform-desktop',
      dependencies: ['setup'],
      testMatch: ['platform/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], storageState: PLATFORM.storageState },
    },

    // Public / unauthenticated flows (login, onboarding, auth). No stored session.
    {
      name: 'public-desktop',
      dependencies: ['setup'],
      testMatch: ['public/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], storageState: { cookies: [], origins: [] } },
    },
    {
      name: 'public-mobile',
      dependencies: ['setup'],
      testMatch: ['public/**/*.spec.ts'],
      use: { ...devices['Pixel 5'], storageState: { cookies: [], origins: [] } },
    },
  ],
})
