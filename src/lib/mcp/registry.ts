import type { SupabaseClient } from '@supabase/supabase-js'

import type { McpScope, Profile } from '../supabase/types.ts'
import type { ResolvedGrant } from './grants.ts'

export type { ResolvedGrant } from './grants.ts'

export type ToolContext = {
  supabase: SupabaseClient
  profile: Profile
  grant: ResolvedGrant
  auditEntity?: { type: string; id: string }
}

export type McpToolDefinition = {
  name: string
  description: string
  scope: McpScope
  adminOnly?: boolean
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

export type Registry = {
  visibleTools(grant: ResolvedGrant, profile: Pick<Profile, 'role'>): McpToolDefinition[]
  findTool(name: string): McpToolDefinition | undefined
}

export function createRegistry(definitions: McpToolDefinition[]): Registry {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  return {
    visibleTools(grant, profile) {
      return definitions.filter(
        (definition) => grant.scopes.includes(definition.scope) && (!definition.adminOnly || profile.role === 'admin')
      )
    },
    findTool(name) {
      return byName.get(name)
    },
  }
}
