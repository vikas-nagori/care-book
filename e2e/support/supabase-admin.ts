// Service-role Supabase client for the E2E seed harness. Bypasses RLS and can call the GoTrue
// admin API (createUser). Points at the LOCAL stack via .env.e2e — never a hosted project.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      'E2E seed needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY (load .env.e2e).',
    )
  }

  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    throw new Error(`E2E seed received an invalid NEXT_PUBLIC_SUPABASE_URL: ${url}`)
  }
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error(`Refusing to seed a non-local Supabase URL: ${url}`)
  }

  if (cached) return cached
  cached = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
