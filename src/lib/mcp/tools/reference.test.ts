import assert from 'node:assert/strict'
import test from 'node:test'

import type { ToolContext } from '../registry.ts'
import { referenceTools } from './reference.ts'

function fakeSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const result = { data: tables[table] ?? [], error: null }
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'in', 'eq', 'order']) chain[method] = () => chain
      chain.then = (resolve: (value: typeof result) => unknown) => resolve(result)
      return chain
    },
  }
}

// Incident 2026-11-24: a profile with neither name nor email (a pending mobile-only invitee)
// made the name filter throw on `.toLocaleLowerCase()` of null.
test('carebook_list_staff filters by name when a profile has no name or email', async () => {
  const tool = referenceTools.find((candidate) => candidate.name === 'carebook_list_staff')!
  const ctx = {
    supabase: fakeSupabase({
      profiles: [
        { full_name: 'Asha Rao', email: 'asha@x.test', mobile_number: '9511219264', role: 'staff' },
        { full_name: null, email: null, mobile_number: '9876543210', role: 'staff' },
      ],
      external_staff: [{ name: 'Ravi', email: null, status: 'active' }],
    }),
  } as unknown as ToolContext

  const filtered = (await tool.handler({ name: 'asha' }, ctx)) as { staff: Array<{ name: string }> }
  assert.deepEqual(filtered.staff.map((person) => person.name), ['Asha Rao'])

  const byMobile = (await tool.handler({ name: '98765' }, ctx)) as { staff: Array<{ name: string }> }
  assert.deepEqual(byMobile.staff.map((person) => person.name), ['98765 43210'])
})
