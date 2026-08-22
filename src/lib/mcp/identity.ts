import crypto from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/admin.ts'
import { decryptSecret, encryptSecret } from './session-crypto.ts'

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

export function mintSupabaseUserJwt(input: {
  userId: string
  email: string
  ttlSeconds?: number
}): string {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) throw new Error('SUPABASE_JWT_SECRET is required to mint MCP user tokens')

  const now = Math.floor(Date.now() / 1000)
  const ttl = input.ttlSeconds ?? 60
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      sub: input.userId,
      email: input.email,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: now + ttl,
      app_metadata: { provider: 'mcp' },
      user_metadata: {},
    })
  )
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

export function createUserScopedClient(jwt: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.')

  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
}

export function createRefreshClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

export type GrantIdentity = {
  grantId: string
  userId: string
  email: string
  supabaseRefreshTokenCiphertext: string | null
  supabaseRefreshTokenNonce: string | null
  supabaseRefreshTokenVersion: number
}

const refreshLocks = new Map<string, Promise<SupabaseClient>>()

export async function createUserScopedClientForGrant(grant: GrantIdentity): Promise<SupabaseClient> {
  if (process.env.SUPABASE_JWT_SECRET) {
    return createUserScopedClient(mintSupabaseUserJwt({ userId: grant.userId, email: grant.email }))
  }

  if (!grant.supabaseRefreshTokenCiphertext || !grant.supabaseRefreshTokenNonce) {
    throw new Error('MCP identity fallback is not configured for this grant')
  }

  const existing = refreshLocks.get(grant.grantId)
  if (existing) return existing

  const refresh = refreshUserSession(grant)
  refreshLocks.set(grant.grantId, refresh)
  try {
    return await refresh
  } finally {
    refreshLocks.delete(grant.grantId)
  }
}

async function refreshUserSession(grant: GrantIdentity): Promise<SupabaseClient> {
  const refreshToken = decryptSecret({
    ciphertext: grant.supabaseRefreshTokenCiphertext!,
    nonce: grant.supabaseRefreshTokenNonce!,
  })
  const client = createRefreshClient()
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.session?.access_token || !data.session.refresh_token) {
    throw new Error('The linked Care-Book session could not be refreshed')
  }

  const encrypted = encryptSecret(data.session.refresh_token)
  const admin = createAdminClient()
  await admin
    .from('mcp_access_grants')
    .update({
      supabase_refresh_token_ciphertext: encrypted.ciphertext,
      supabase_refresh_token_nonce: encrypted.nonce,
      supabase_refresh_token_version: grant.supabaseRefreshTokenVersion + 1,
    })
    .eq('id', grant.grantId)
    .eq('supabase_refresh_token_version', grant.supabaseRefreshTokenVersion)

  return createUserScopedClient(data.session.access_token)
}
