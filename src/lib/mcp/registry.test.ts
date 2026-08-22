import assert from 'node:assert/strict'
import test from 'node:test'

import { createRegistry } from './registry.ts'
import type { McpToolDefinition } from './registry.ts'

const defs: McpToolDefinition[] = [
  { name: 'r', description: 'read', scope: 'read', inputSchema: {}, handler: async () => ({}) },
  { name: 'w', description: 'write', scope: 'write:clinical', inputSchema: {}, handler: async () => ({}) },
  { name: 'b', description: 'bill', scope: 'write:billing', adminOnly: true, inputSchema: {}, handler: async () => ({}) },
]

const grant = (scopes: string[]) => ({
  grantId: 'g',
  userId: 'u',
  clinicId: 'c',
  email: 'a@b.test',
  clientId: 'client',
  resource: 'https://example.test/api/mcp',
  supabaseRefreshTokenCiphertext: null,
  supabaseRefreshTokenNonce: null,
  supabaseRefreshTokenVersion: 0,
  scopes: scopes as never,
})

test('a read-only grant sees only read tools', () => {
  const registry = createRegistry(defs)
  assert.deepEqual(registry.visibleTools(grant(['read']), { role: 'admin' } as never).map((tool) => tool.name), ['r'])
})

test('staff cannot see admin-only billing tools', () => {
  const registry = createRegistry(defs)
  assert.deepEqual(registry.visibleTools(grant(['read', 'write:billing']), { role: 'staff' } as never).map((tool) => tool.name), ['r'])
})

test('an admin with the scope sees the admin-only tool', () => {
  const registry = createRegistry(defs)
  assert.deepEqual(registry.visibleTools(grant(['read', 'write:billing']), { role: 'admin' } as never).map((tool) => tool.name), ['r', 'b'])
})

test('findTool resolves by exact name only', () => {
  const registry = createRegistry(defs)
  assert.equal(registry.findTool('r')?.name, 'r')
  assert.equal(registry.findTool('R'), undefined)
})
