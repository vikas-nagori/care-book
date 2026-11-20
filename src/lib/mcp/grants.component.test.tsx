import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('../supabase/admin.ts', () => ({ createAdminClient }))

import { issueAuthorizationCode, redeemAuthorizationCode, refreshGrant, resolveBearer } from './grants'

const clientId = 'clinic-tool'
const redirectUri = 'https://tool.example/callback'
const resource = 'https://care.example/api/mcp'
const userId = 'user-1'
const clinicId = 'clinic-1'
const codeVerifier = 'care-book-test-verifier'
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
const scopes = ['read'] as const

function adminWithProfile(role: 'staff' | 'external_staff') {
  const codeRow = {
    expires_at: '2999-01-01T00:00:00.000Z',
    user_id: userId,
    clinic_id: clinicId,
    client_id: clientId,
    redirect_uri: redirectUri,
    resource,
    scopes,
    code_challenge: codeChallenge,
  }
  const grantRow = {
    id: 'grant-1',
    user_id: userId,
    clinic_id: clinicId,
    client_id: clientId,
    resource,
    scopes,
  }
  const chain = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
  }
  const inserts = vi.fn().mockResolvedValue({ error: null })
  const updates = vi.fn().mockReturnValue({
    ...chain,
    select: vi.fn().mockResolvedValue({ data: [{ scopes }], error: null }),
  })
  const tables = {
    clinics: { select: () => ({ ...chain, maybeSingle: async () => ({ data: { status: 'active' } }) }) },
    profiles: { select: () => ({
      ...chain, maybeSingle: async () => ({ data: { role, status: 'active', clinic_id: clinicId } }),
    }) },
    mcp_access_grants: {
      select: () => ({ ...chain, maybeSingle: async () => ({ data: grantRow }) }),
      insert: inserts,
      update: updates,
    },
    mcp_authorization_codes: {
      delete: () => ({ ...chain, select: async () => ({ data: [codeRow], error: null }), lt: async () => {} }),
      insert: inserts,
    },
  }
  createAdminClient.mockReturnValue({
    from: (table: keyof typeof tables) => tables[table],
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'user@care.example' } } }) } },
  })
  return { inserts, updates }
}

describe('External Staff MCP grant authorization', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://care.example'))

  it('denies issuing an authorization code after the profile becomes External Staff', async () => {
    const { inserts } = adminWithProfile('external_staff')
    await expect(issueAuthorizationCode({
      clientId, clinicId, userId, scopes: [...scopes], codeChallenge, redirectUri, resource,
    })).rejects.toMatchObject({ code: 'access_denied' })
    expect(inserts).not.toHaveBeenCalled()
  })

  it('denies redeeming a code issued before the profile became External Staff', async () => {
    const { inserts } = adminWithProfile('external_staff')
    await expect(redeemAuthorizationCode({
      code: 'old-code', clientId, redirectUri, resource, codeVerifier,
    })).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(inserts).not.toHaveBeenCalled()
  })

  it('denies refreshing a grant issued before the profile became External Staff', async () => {
    const { updates } = adminWithProfile('external_staff')
    await expect(refreshGrant({ refreshToken: 'old-refresh', clientId, resource })).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(updates).toHaveBeenCalledWith({ revoked_at: expect.any(String) })
  })

  it('denies an old bearer and revokes the grant when its owner becomes External Staff', async () => {
    const { updates } = adminWithProfile('external_staff')
    await expect(resolveBearer('old-access')).resolves.toBeNull()
    expect(updates).toHaveBeenCalledWith({ revoked_at: expect.any(String) })
  })

  it('keeps grants usable for active Staff', async () => {
    adminWithProfile('staff')
    await expect(resolveBearer('staff-access')).resolves.toMatchObject({ userId, clinicId })
  })
})
