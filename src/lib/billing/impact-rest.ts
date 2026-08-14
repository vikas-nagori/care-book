import type { SupabaseBillingSource } from './impact-source.ts'

export const CARE_BOOK_PRODUCTION_PROJECT_REF = 'byhccyhbdnqslqdktybt'

const REQUIRED_TABLES = [
  'clinics',
  'patients',
  'appointment_types',
  'global_settings',
  'package_templates',
  'appointments',
  'packages',
  'payments',
  'appointment_payments',
  'package_session_allocations',
] as const
const OPTIONAL_V2_TABLES = ['refunds', 'refund_reversals'] as const

interface FetchBillingSourceOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetcher?: typeof fetch
  pageSize?: number
}

export function assertExpectedSupabaseProject(supabaseUrl: string, expectedProjectRef: string): void {
  const actualProjectRef = new URL(supabaseUrl).hostname.split('.')[0]
  if (actualProjectRef !== expectedProjectRef) {
    throw new Error(`Supabase project reference mismatch: expected ${expectedProjectRef}, received ${actualProjectRef}`)
  }
}

async function readTable(
  table: string,
  options: Required<Pick<FetchBillingSourceOptions, 'supabaseUrl' | 'serviceRoleKey' | 'pageSize'>> & { fetcher: typeof fetch },
  optional: boolean,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; ; offset += options.pageSize) {
    const endpoint = `${options.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?select=*&order=id.asc`
    const response = await options.fetcher(endpoint, {
      method: 'GET',
      headers: {
        apikey: options.serviceRoleKey,
        Authorization: `Bearer ${options.serviceRoleKey}`,
        Range: `${offset}-${offset + options.pageSize - 1}`,
        Prefer: 'count=exact',
      },
    })
    if (!response.ok) {
      const body = await response.text()
      const missingTable = response.status === 404 && (body.includes('PGRST205') || body.includes('42P01') || body.includes('not found'))
      if (optional && missingTable) return []
      throw new Error(`Read-only billing audit failed for ${table}: HTTP ${response.status}`)
    }
    const page = await response.json() as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < options.pageSize) return rows
  }
}

export async function fetchSupabaseBillingSource(options: FetchBillingSourceOptions): Promise<SupabaseBillingSource> {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(options.supabaseUrl)) {
    throw new Error('Expected a Supabase project URL before starting the read-only audit.')
  }
  if (!options.serviceRoleKey) throw new Error('Missing service role key for the read-only audit.')
  const resolved = {
    supabaseUrl: options.supabaseUrl,
    serviceRoleKey: options.serviceRoleKey,
    fetcher: options.fetcher ?? fetch,
    pageSize: options.pageSize ?? 1000,
  }
  const source: SupabaseBillingSource = {}
  for (const table of REQUIRED_TABLES) source[table] = await readTable(table, resolved, false)
  for (const table of OPTIONAL_V2_TABLES) source[table] = await readTable(table, resolved, true)
  return source
}
