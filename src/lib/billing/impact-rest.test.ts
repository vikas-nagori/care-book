import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CARE_BOOK_PRODUCTION_PROJECT_REF, assertExpectedSupabaseProject, fetchSupabaseBillingSource } from './impact-rest.ts'

test('uses GET-only paginated reads and tolerates v2 tables missing on migration 029', async () => {
  const requests: Array<{ url: string; method: string }> = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, method: init?.method ?? 'GET' })
    if (url.includes('/refunds') || url.includes('/refund_reversals')) {
      return new Response(JSON.stringify({ code: 'PGRST205', message: 'table not found' }), { status: 404 })
    }
    return new Response('[]', { status: 200 })
  }

  const source = await fetchSupabaseBillingSource({
    supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'secret', fetcher,
  })

  assert.ok(requests.length >= 9)
  assert.ok(requests.every((request) => request.method === 'GET'))
  assert.ok(requests.every((request) => request.url.includes('?select=')))
  assert.deepEqual(source.refunds, [])
  assert.deepEqual(source.refund_reversals, [])
})

test('fails closed for authorization or unexpected REST errors', async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 })
  await assert.rejects(
    fetchSupabaseBillingSource({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'secret', fetcher }),
    /HTTP 403/,
  )
})

test('requires the approved production project reference before any request', () => {
  assert.doesNotThrow(() => assertExpectedSupabaseProject(
    'https://byhccyhbdnqslqdktybt.supabase.co',
    CARE_BOOK_PRODUCTION_PROJECT_REF,
  ))
  assert.throws(() => assertExpectedSupabaseProject(
    'https://different.supabase.co',
    CARE_BOOK_PRODUCTION_PROJECT_REF,
  ), /project reference mismatch/)
})
