import type { McpScope } from '../supabase/types.ts'

export const MCP_SCOPES = ['read', 'write:clinical', 'write:billing'] as const satisfies readonly McpScope[]

export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  read: 'Read patients, appointments, and clinical session notes visible to you',
  'write:clinical': 'Create patients and appointments',
  'write:billing': 'Record and change billing records through audited billing operations',
}

export function mcpOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL
  if (!raw) throw new Error('NEXT_PUBLIC_SITE_URL is required for MCP endpoints')
  return raw.replace(/\/+$/, '')
}

export function mcpIssuer(): string {
  return mcpOrigin()
}

export function mcpResourceUrl(): string {
  return `${mcpOrigin()}/api/mcp`
}

export function isMcpEnabled(): boolean {
  return process.env.MCP_ENABLED === 'true'
}

export function parseScopes(raw: string | undefined | null): McpScope[] {
  if (!raw) return []
  const known = new Set<string>(MCP_SCOPES)
  const seen = new Set<McpScope>()
  for (const candidate of raw.split(/\s+/).filter(Boolean)) {
    if (known.has(candidate)) seen.add(candidate as McpScope)
  }
  return [...seen]
}
