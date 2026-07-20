import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { adminClient } from './supabase-admin.ts'

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl

  if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey

  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey
})

test('adminClient rejects a hosted Supabase URL', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'hosted-anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'hosted-service-role-key'

  assert.throws(
    () => adminClient(),
    /refusing to seed a non-local Supabase URL/i,
  )
})
