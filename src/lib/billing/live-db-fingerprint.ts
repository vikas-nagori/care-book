import { createHash } from 'node:crypto'

import type { SupabaseBillingSource } from './impact-source.ts'

export const LIVE_DB_FINGERPRINT_VERSION = 'carebook-billing-source-v1'
export const LIVE_DB_FINGERPRINT_TABLES = [
  'clinics', 'patients', 'appointment_types', 'global_settings', 'package_templates',
  'appointments', 'packages', 'payments', 'appointment_payments', 'package_session_allocations',
] as const

type Row = Record<string, unknown>
type Kind = 'text' | 'integer' | 'money' | 'boolean' | 'date' | 'time' | 'timestamp'

const TABLES: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, Kind]>]> = [
  ['clinics', [['id', 'text'], ['name', 'text']]],
  ['patients', [['id', 'text'], ['clinic_id', 'text'], ['name', 'text']]],
  ['appointment_types', [
    ['id', 'text'], ['clinic_id', 'text'], ['name', 'text'], ['session_rate', 'money'],
    ['is_shared', 'boolean'], ['is_default', 'boolean'], ['sort_order', 'integer'], ['created_at', 'timestamp'],
  ]],
  ['global_settings', [
    ['id', 'integer'], ['clinic_id', 'text'], ['home_visit_fee', 'money'], ['clinic_fee', 'money'],
  ]],
  ['package_templates', [
    ['id', 'text'], ['clinic_id', 'text'], ['name', 'text'], ['min_sessions', 'integer'],
    ['per_session_amount', 'money'], ['created_at', 'timestamp'],
  ]],
  ['appointments', [
    ['id', 'text'], ['clinic_id', 'text'], ['patient_id', 'text'], ['appointment_type_id', 'text'],
    ['date', 'date'], ['time', 'time'], ['status', 'text'], ['fee', 'money'],
    ['payment_status', 'text'], ['created_at', 'timestamp'],
  ]],
  ['packages', [
    ['id', 'text'], ['clinic_id', 'text'], ['patient_id', 'text'], ['name', 'text'],
    ['total_sessions', 'integer'], ['used_sessions', 'integer'], ['total_amount', 'money'],
    ['per_session_amount', 'money'], ['paid_amount', 'money'], ['payment_timing', 'text'],
    ['status', 'text'], ['created_at', 'timestamp'],
  ]],
  ['payments', [
    ['id', 'text'], ['clinic_id', 'text'], ['patient_id', 'text'], ['package_id', 'text'],
    ['appointment_id', 'text'], ['amount', 'money'], ['payment_method', 'text'], ['date', 'date'],
    ['notes', 'text'], ['created_at', 'timestamp'],
  ]],
  ['appointment_payments', [
    ['id', 'text'], ['payment_id', 'text'], ['appointment_id', 'text'],
    ['amount_applied', 'money'], ['created_at', 'timestamp'],
  ]],
  ['package_session_allocations', [
    ['id', 'text'], ['package_id', 'text'], ['appointment_id', 'text'], ['created_at', 'timestamp'],
  ]],
]

function timestampMicros(value: unknown): string {
  const text = String(value)
  const match = text.match(/^(.+T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2})$/)
  if (!match) throw new Error(`Invalid billing fingerprint timestamp: ${text}`)
  const fraction = (match[2] ?? '').padEnd(6, '0').slice(0, 6)
  const milliseconds = Date.parse(`${match[1]}.${fraction.slice(0, 3)}${match[3]}`)
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid billing fingerprint timestamp: ${text}`)
  return String(milliseconds * 1000 + Number(fraction.slice(3)))
}

function normalize(value: unknown, kind: Kind): string | null {
  if (value === null || value === undefined) return null
  switch (kind) {
    case 'money': return Number(value).toFixed(2)
    case 'integer': return String(Number(value))
    case 'boolean': return value === true || value === 'true' ? 'true' : 'false'
    case 'timestamp': return timestampMicros(value)
    case 'date': return String(value).slice(0, 10)
    case 'time': return String(value).replace(/(?:\.0+)?(?:[+-]\d{2}:?\d{2}|Z)?$/, '')
    default: return String(value)
  }
}

function encode(value: string | null): string {
  return value === null ? '-1:' : `${Buffer.byteLength(value, 'utf8')}:${value}`
}

export function buildLiveDatabaseFingerprint(source: SupabaseBillingSource): string {
  const parts = [`version=${encode(LIVE_DB_FINGERPRINT_VERSION)}\n`]
  for (const [table, fields] of TABLES) {
    const rows = [...(source[table] ?? [])].sort((left, right) => table === 'global_settings'
      ? Number(left.id) - Number(right.id)
      : String(left.id).localeCompare(String(right.id)))
    parts.push(`table=${encode(table)};count=${rows.length}\n`)
    for (const row of rows as Row[]) {
      parts.push(fields.map(([field, kind]) => `${field}=${encode(normalize(row[field], kind))}`).join(';'), '\n')
    }
  }
  return createHash('sha256').update(parts.join('')).digest('hex')
}

export function buildBillingSourceRowCounts(source: SupabaseBillingSource): Record<string, number> {
  return Object.fromEntries(LIVE_DB_FINGERPRINT_TABLES.map((table) => [table, source[table]?.length ?? 0]))
}
