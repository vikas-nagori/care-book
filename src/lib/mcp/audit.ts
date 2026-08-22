import crypto from 'node:crypto'
import { createAdminClient } from '../supabase/admin.ts'
import type { ResolvedGrant } from './grants.ts'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

export function requestDigest(toolName: string, args: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonical({ tool: toolName, args }))).digest('hex')
}

export type InvocationStatus = 'ok' | 'error' | 'denied' | 'dry_run'

export async function findSuccessfulInvocation(grant: ResolvedGrant, idempotencyKey: string, digest: string) {
  const { data, error } = await createAdminClient()
    .from('mcp_tool_invocations')
    .select('request_digest, result_json')
    .eq('grant_id', grant.grantId)
    .eq('idempotency_key', idempotencyKey)
    .eq('status', 'ok')
    .maybeSingle()
  if (error || !data) return null
  if (data.request_digest !== digest) return { conflict: true as const }
  return { result: data.result_json as unknown }
}

export async function recordInvocation(input: {
  grant: ResolvedGrant
  toolName: string
  idempotencyKey?: string | null
  digest: string
  status: InvocationStatus
  result?: unknown
  errorCode?: string | null
  entityType?: string | null
  entityId?: string | null
  durationMs?: number
}) {
  const { error } = await createAdminClient().from('mcp_tool_invocations').insert({
    grant_id: input.grant.grantId,
    user_id: input.grant.userId,
    clinic_id: input.grant.clinicId,
    tool_name: input.toolName,
    idempotency_key: input.idempotencyKey ?? null,
    request_digest: input.digest,
    status: input.status,
    result_json: input.result ?? null,
    error_code: input.errorCode ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    duration_ms: input.durationMs ?? null,
  })
  if (error) throw new Error('MCP audit record could not be written')
}
