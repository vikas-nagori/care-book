import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

// Load the committed local-stack env (URL + well-known local keys) for the seed harness and
// the app under test. See .env.e2e — these are non-secret local-development keys.
dotenv.config({ path: '.env.e2e', override: true })

import { ADMIN, STAFF, PLATFORM } from './e2e/support/accounts'

const CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  // The setup project seeds + authenticates first. Keep the browser matrix serial: local GoTrue
  // opens enough short-lived database connections during this full suite that parallel workers can
  // exhaust the Docker network's available source sockets and turn healthy auth requests into 500s.
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: 1,
  reporter: CI ? [['html', { open: 'never' }], ['github']] : [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  // Build once with the local-stack env, then serve the production build. Never reuse an arbitrary
  // port-3000 process: it may have been built against a hosted Supabase project while the harness
  // cleanup still targets the local stack. Timeout covers a cold `next build`.
  webServer: {
    command: 'npm run build:e2e && npm run start:e2e',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
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
      testIgnore: ['platform/zz-signout.spec.ts'],
      use: { ...devices['Desktop Chrome'], storageState: PLATFORM.storageState },
    },
    {
      name: 'platform-signout',
      // Sign in afresh with a dedicated identity inside every attempt because a failed attempt has
      // already revoked its token. Keep this dependency so sign-out follows all console specs.
      dependencies: ['platform-desktop'],
      testMatch: ['platform/zz-signout.spec.ts'],
      use: { ...devices['Desktop Chrome'], storageState: { cookies: [], origins: [] } },
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
