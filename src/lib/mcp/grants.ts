import { createAdminClient } from '../supabase/admin.ts'
import { mcpResourceUrl } from './config.ts'
import type { McpScope } from '../supabase/types.ts'
import { verifyCodeChallenge } from './pkce.ts'
import { decryptSecret, encryptSecret } from './session-crypto.ts'
import { generateToken, hashToken } from './tokens.ts'
import { OAuthError } from './errors.ts'

export { OAuthError } from './errors.ts'

const ACCESS_TTL_SECONDS = 3600
const CODE_TTL_SECONDS = 60

export type GrantTokens = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: McpScope[]
}

export type ResolvedGrant = {
  grantId: string
  userId: string
  clinicId: string
  email: string
  clientId: string
  resource: string
  scopes: McpScope[]
  supabaseRefreshTokenCiphertext: string | null
  supabaseRefreshTokenNonce: string | null
  supabaseRefreshTokenVersion: number
}

export async function issueAuthorizationCode(input: {
  clientId: string
  userId: string
  clinicId: string
  scopes: McpScope[]
  codeChallenge: string
  redirectUri: string
  resource: string
  supabaseRefreshToken?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const code = generateToken('code')
  const encrypted = input.supabaseRefreshToken ? encryptSecret(input.supabaseRefreshToken) : null

  const { error } = await supabase.from('mcp_authorization_codes').insert({
    code_hash: hashToken(code),
    client_id: input.clientId,
    user_id: input.userId,
    clinic_id: input.clinicId,
    scopes: input.scopes,
    code_challenge: input.codeChallenge,
    redirect_uri: input.redirectUri,
    resource: input.resource,
    supabase_refresh_token_ciphertext: encrypted?.ciphertext ?? null,
    supabase_refresh_token_nonce: encrypted?.nonce ?? null,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) throw new OAuthError('server_error', 'Could not issue an authorization code.')
  return code
}

export async function redeemAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  resource: string
  codeVerifier: string
}): Promise<GrantTokens> {
  const supabase = createAdminClient()
  const { data: rows, error } = await supabase
    .from('mcp_authorization_codes')
    .delete()
    .eq('code_hash', hashToken(input.code))
    .select('*')
  const row = rows?.[0] as Record<string, unknown> | undefined

  if (error || !row) throw new OAuthError('invalid_grant', 'Unknown or already-used authorization code.')
  if (new Date(String(row.expires_at)).getTime() < Date.now()) throw new OAuthError('invalid_grant', 'Authorization code expired.')
  if (row.client_id !== input.clientId) throw new OAuthError('invalid_grant', 'Client mismatch.')
  if (row.redirect_uri !== input.redirectUri) throw new OAuthError('invalid_grant', 'Redirect URI mismatch.')
  if (row.resource !== input.resource) throw new OAuthError('invalid_target', 'Resource mismatch.')
  if (!verifyCodeChallenge(input.codeVerifier, String(row.code_challenge))) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed.')
  }

  return createGrant({
    userId: String(row.user_id),
    clinicId: String(row.clinic_id),
    clientId: String(row.client_id),
    scopes: row.scopes as McpScope[],
    resource: String(row.resource),
    supabaseRefreshTokenCiphertext: typeof row.supabase_refresh_token_ciphertext === 'string' ? row.supabase_refresh_token_ciphertext : null,
    supabaseRefreshTokenNonce: typeof row.supabase_refresh_token_nonce === 'string' ? row.supabase_refresh_token_nonce : null,
  })
}

async function createGrant(input: {
  userId: string
  clinicId: string
  clientId: string
  scopes: McpScope[]
  resource: string
  supabaseRefreshTokenCiphertext: string | null
  supabaseRefreshTokenNonce: string | null
}): Promise<GrantTokens> {
  const supabase = createAdminClient()
  const accessToken = generateToken('at')
  const refreshToken = generateToken('rt')
  const { error } = await supabase.from('mcp_access_grants').insert({
    user_id: input.userId,
    clinic_id: input.clinicId,
    client_id: input.clientId,
    scopes: input.scopes,
    resource: input.resource,
    access_token_hash: hashToken(accessToken),
    refresh_token_hash: hashToken(refreshToken),
    access_expires_at: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString(),
    refresh_expires_at: null,
    supabase_refresh_token_ciphertext: input.supabaseRefreshTokenCiphertext,
    supabase_refresh_token_nonce: input.supabaseRefreshTokenNonce,
  })
  if (error) throw new OAuthError('server_error', 'Could not create the grant.')
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, scopes: input.scopes }
}

export async function refreshGrant(input: {
  refreshToken: string
  clientId: string
  resource: string
}): Promise<GrantTokens> {
  const supabase = createAdminClient()
  const { data: current } = await supabase
    .from('mcp_access_grants')
    .select('id, user_id, clinic_id')
    .eq('refresh_token_hash', hashToken(input.refreshToken))
    .eq('client_id', input.clientId)
    .eq('resource', input.resource)
    .is('revoked_at', null)
    .or(`refresh_expires_at.is.null,refresh_expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle()
  if (!current || !(await grantOwnerIsActive(supabase, current.user_id, current.clinic_id))) {
    if (current) await supabase.from('mcp_access_grants').update({ revoked_at: new Date().toISOString() }).eq('id', current.id)
    throw new OAuthError('invalid_grant', 'Unknown, expired or revoked refresh token.')
  }
  const accessToken = generateToken('at')
  const refreshToken = generateToken('rt')
  const { data: rows, error } = await supabase
    .from('mcp_access_grants')
    .update({
      access_token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(refreshToken),
      access_expires_at: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString(),
    })
    .eq('refresh_token_hash', hashToken(input.refreshToken))
    .eq('client_id', input.clientId)
    .eq('resource', input.resource)
    .is('revoked_at', null)
    .or(`refresh_expires_at.is.null,refresh_expires_at.gt.${new Date().toISOString()}`)
    .select('scopes')
  const row = rows?.[0]
  if (error || !row) throw new OAuthError('invalid_grant', 'Unknown, expired or revoked refresh token.')
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, scopes: row.scopes as McpScope[] }
}

export async function resolveBearer(token: string): Promise<ResolvedGrant | null> {
  const supabase = createAdminClient()
  const { data: grant } = await supabase
    .from('mcp_access_grants')
    .select('id, user_id, clinic_id, client_id, resource, scopes, supabase_refresh_token_ciphertext, supabase_refresh_token_nonce, supabase_refresh_token_version')
    .eq('access_token_hash', hashToken(token))
    .is('revoked_at', null)
    .gt('access_expires_at', new Date().toISOString())
    .maybeSingle()
  if (!grant) return null

  // RFC 8707 audience binding: a token is only valid for the resource it was issued against. There
  // is one resource today, so this holds the invariant rather than fixing a live hole — but it is
  // what stops a token minted for some other Care-Book deployment from being replayed here.
  if (grant.resource !== mcpResourceUrl()) return null

  const { data: user } = await supabase.auth.admin.getUserById(grant.user_id)
  if (!user?.user?.email || !(await grantOwnerIsActive(supabase, grant.user_id, grant.clinic_id))) {
    await supabase.from('mcp_access_grants').update({ revoked_at: new Date().toISOString() }).eq('id', grant.id)
    return null
  }
  await supabase.from('mcp_access_grants').update({ last_used_at: new Date().toISOString() }).eq('id', grant.id)

  return {
    grantId: grant.id,
    userId: grant.user_id,
    clinicId: grant.clinic_id,
    clientId: grant.client_id,
    resource: grant.resource,
    email: user.user.email,
    scopes: grant.scopes as McpScope[],
    supabaseRefreshTokenCiphertext: grant.supabase_refresh_token_ciphertext,
    supabaseRefreshTokenNonce: grant.supabase_refresh_token_nonce,
    supabaseRefreshTokenVersion: Number(grant.supabase_refresh_token_version ?? 0),
  }
}

async function grantOwnerIsActive(supabase: ReturnType<typeof createAdminClient>, userId: string, clinicId: string) {
  const [{ data: profile }, { data: clinic }] = await Promise.all([
    supabase.from('profiles').select('clinic_id, status').eq('id', userId).maybeSingle(),
    supabase.from('clinics').select('status').eq('id', clinicId).maybeSingle(),
  ])
  return profile?.status === 'active' && profile.clinic_id === clinicId && clinic?.status === 'active'
}

export async function revokeByToken(token: string): Promise<void> {
  const supabase = createAdminClient()
  const digest = hashToken(token)
  await supabase
    .from('mcp_access_grants')
    .update({ revoked_at: new Date().toISOString() })
    .or(`access_token_hash.eq.${digest},refresh_token_hash.eq.${digest}`)
    .is('revoked_at', null)
}

export async function revokeGrant(grantId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('mcp_access_grants').update({ revoked_at: new Date().toISOString() }).eq('id', grantId)
}

export function decryptGrantRefreshToken(grant: Pick<ResolvedGrant, 'supabaseRefreshTokenCiphertext' | 'supabaseRefreshTokenNonce'>): string | null {
  if (!grant.supabaseRefreshTokenCiphertext || !grant.supabaseRefreshTokenNonce) return null
  return decryptSecret({ ciphertext: grant.supabaseRefreshTokenCiphertext, nonce: grant.supabaseRefreshTokenNonce })
}
