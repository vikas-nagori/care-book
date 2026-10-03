import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const db = vi.hoisted(() => ({ result: { data: [{ id: 'private-appointment-id' }], error: null } as { data: {id: string}[] | null; error: unknown }, throws: false, calls: [] as unknown[][] }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => {
  if (db.throws) throw new Error('private patient detail')
  const chain = {
    update: (value: unknown) => { db.calls.push(['update', value]); return chain },
    eq: (...args: unknown[]) => { db.calls.push(['eq', ...args]); return chain },
    lt: (...args: unknown[]) => { db.calls.push(['lt', ...args]); return chain },
    select: async () => db.result,
  }
  return { from: (table: string) => { db.calls.push(['from', table]); return chain } }
} }))
import { GET } from './route'
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret')
  db.calls = []; db.throws = false; db.result = { data: [{ id: 'private-appointment-id' }], error: null }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
const request = (token = 'test-secret') => new NextRequest('http://localhost/api/cron/auto-complete-appointments', { headers: { authorization: `Bearer ${token}` } })
it('rejects unauthorized callers without touching appointments', async () => {
  expect((await GET(request('wrong'))).status).toBe(401)
  expect(db.calls).toEqual([])
})
it('logs correlated start and completion with counts but no appointment identifiers', async () => {
  const response = await GET(request())
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.updatedCount).toBe(1)
  expect(db.calls).toContainEqual(['eq', 'status', 'scheduled'])
  expect(db.calls).toContainEqual(['lt', 'date', body.beforeDate])
  const lines = vi.mocked(console.log).mock.calls.map(call => JSON.parse(String(call[0])))
  expect(lines.map(line => line.meta.phase)).toEqual(['start', 'complete'])
  expect(lines[1].meta.runId).toBe(lines[0].meta.runId)
  expect(lines[1].meta.updatedCount).toBe(1)
  expect(lines[1].meta.durationMs).toBeGreaterThanOrEqual(0)
  expect(JSON.stringify(lines)).not.toContain('private-appointment-id')
})
it('does not expose database errors in the response', async () => {
  db.result = { data: null, error: { message: 'private patient detail', code: '08006' } }
  const response = await GET(request())
  expect(response.status).toBe(500)
  expect(JSON.stringify(await response.json())).not.toContain('private patient detail')
  expect(console.error).toHaveBeenCalled()
})
it('logs unexpected failures and returns a generic error', async () => {
  db.throws = true
  expect((await GET(request())).status).toBe(500)
  expect(console.error).toHaveBeenCalled()
})
