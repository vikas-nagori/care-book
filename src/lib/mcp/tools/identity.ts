import type { McpToolDefinition } from '../registry.ts'
import { objectSchema } from '../schema.ts'

export const identityTools: McpToolDefinition[] = [
  {
    name: 'carebook_whoami',
    description: 'Return the linked Care-Book account, role, clinic, and MCP scopes. Does not return billing data.',
    scope: 'read',
    inputSchema: objectSchema({}),
    handler: async (_args, ctx) => {
      const { data: clinic } = await ctx.supabase.from('clinics').select('name').eq('id', ctx.profile.clinic_id).maybeSingle()
      return {
        user: { email: ctx.profile.email, name: ctx.profile.full_name, role: ctx.profile.role },
        clinic: clinic?.name ? { name: clinic.name } : null,
        scopes: ctx.grant.scopes,
      }
    },
  },
]
