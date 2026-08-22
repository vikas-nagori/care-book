import type { McpToolDefinition } from '../registry.ts'
import { objectSchema, stringProp } from '../schema.ts'

export const referenceTools: McpToolDefinition[] = [
  {
    name: 'carebook_list_appointment_types',
    description: 'List appointment type names available to the connected user. Billing rates are not returned.',
    scope: 'read',
    inputSchema: objectSchema({}),
    handler: async (_args, ctx) => {
      const { data, error } = await ctx.supabase.from('appointment_types').select('name, is_shared, sort_order').order('sort_order')
      if (error) throw error
      return { appointment_types: data ?? [] }
    },
  },
  {
    name: 'carebook_list_staff',
    description: 'List active internal and external staff names for appointment assignment. Raw identifiers are not returned.',
    scope: 'read',
    inputSchema: objectSchema({ name: stringProp('Optional name filter') }),
    handler: async (args, ctx) => {
      const filter = typeof args.name === 'string' ? args.name.trim().toLocaleLowerCase() : ''
      const [{ data: profiles, error: profilesError }, { data: external, error: externalError }] = await Promise.all([
        ctx.supabase.from('profiles').select('full_name, email, role').eq('status', 'active').order('full_name'),
        ctx.supabase.from('external_staff').select('name, email, status').eq('status', 'active').order('name'),
      ])
      if (profilesError || externalError) throw profilesError ?? externalError
      const staff = [
        ...(profiles ?? []).map((profile) => ({ name: profile.full_name || profile.email, role: profile.role, kind: 'internal' as const })),
        ...(external ?? []).map((person) => ({ name: person.name, role: 'external', kind: 'external' as const })),
      ].filter((person) => !filter || person.name.toLocaleLowerCase().includes(filter))
      return { staff }
    },
  },
  {
    name: 'carebook_list_doctors',
    description: 'List referral doctors by name and specialty. Raw identifiers are not returned.',
    scope: 'read',
    inputSchema: objectSchema({ name: stringProp('Optional doctor name filter') }),
    handler: async (args, ctx) => {
      const filter = typeof args.name === 'string' ? args.name.trim().toLocaleLowerCase() : ''
      const { data, error } = await ctx.supabase.from('doctors').select('name, specialty').order('name')
      if (error) throw error
      const doctors = (data ?? []).filter((doctor) => !filter || doctor.name.toLocaleLowerCase().includes(filter))
      return { doctors }
    },
  },
]
