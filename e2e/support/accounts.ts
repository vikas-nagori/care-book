// Test accounts and fixed seed IDs for the E2E suite. Everything here is seeded into the
// LOCAL Supabase stack by e2e/support/seed.ts and authenticated by e2e/setup/global.setup.ts.
//
// IDs are fixed so seeding is idempotent (re-running upserts the same rows) and specs can
// reference known data. Platform-admin emails MUST match PLATFORM_ADMIN_EMAILS in .env.e2e.

import { join } from 'node:path'

// Playwright runs from the repo root (the config's directory), so resolve against cwd.
// Avoids import.meta, which breaks under Playwright's default CommonJS transpile.
const authDir = join(process.cwd(), 'e2e', '.auth')

/** storageState path for a given role slug. */
export const storageStatePath = (slug: string) => join(authDir, `${slug}.json`)

export const PASSWORD = 'e2e-Password-123!'

/** Two clinics so tenant-isolation can be exercised. Clinic A holds the primary accounts. */
export const CLINIC_A = {
  id: '00000000-0000-4000-a000-0000000000a1',
  name: 'Care-Book E2E Clinic A',
}
export const CLINIC_B = {
  id: '00000000-0000-4000-a000-0000000000b2',
  name: 'Care-Book E2E Clinic B',
}

export type Role = 'admin' | 'staff'

export type Account = {
  /** Short slug used for the storageState filename and Playwright project name. */
  slug: string
  email: string
  role: Role
  clinicId: string
  /** True for the /platform super-admin (email must be in PLATFORM_ADMIN_EMAILS). */
  platformAdmin?: boolean
  storageState: string
}

function account(a: Omit<Account, 'storageState'>): Account {
  return { ...a, storageState: storageStatePath(a.slug) }
}

/** Clinic A admin — full access incl. Billing. */
export const ADMIN = account({ slug: 'admin', email: 'admin@carebook.test', role: 'admin', clinicId: CLINIC_A.id })
/** Clinic A staff — no Billing, appointment visibility narrowed. */
export const STAFF = account({ slug: 'staff', email: 'staff@carebook.test', role: 'staff', clinicId: CLINIC_A.id })
/** Second Clinic A staff — used to assert one staff can't see another's private appointments. */
export const STAFF2 = account({ slug: 'staff2', email: 'staff2@carebook.test', role: 'staff', clinicId: CLINIC_A.id })
/** Platform super-admin — gated by email allowlist, not clinic role. */
export const PLATFORM = account({ slug: 'platform', email: 'platform-admin@carebook.test', role: 'admin', clinicId: CLINIC_A.id, platformAdmin: true })
/** Dedicated platform identity whose session may be globally revoked by the sign-out test. */
export const PLATFORM_SIGNOUT = account({ slug: 'platform-signout', email: 'platform-signout@carebook.test', role: 'admin', clinicId: CLINIC_A.id, platformAdmin: true })
/** Clinic B admin — for tenant-isolation checks. */
export const CLINIC_B_ADMIN = account({ slug: 'clinic-b-admin', email: 'admin-b@carebook.test', role: 'admin', clinicId: CLINIC_B.id })

/** Every account seeded into auth + profiles. */
export const ALL_ACCOUNTS: Account[] = [ADMIN, STAFF, STAFF2, PLATFORM, PLATFORM_SIGNOUT, CLINIC_B_ADMIN]

/** Accounts whose storageState is reused across specs; excludes the destructive sign-out identity. */
export const AUTHENTICATED_ACCOUNTS: Account[] = [ADMIN, STAFF, STAFF2, PLATFORM, CLINIC_B_ADMIN]
