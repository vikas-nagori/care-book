import { findSuccessfulInvocation } from './audit.ts'
import { ToolError } from './errors.ts'
import type { ResolvedGrant } from './grants.ts'

export async function replaySuccessfulCall(grant: ResolvedGrant, idempotencyKey: string | undefined, digest: string) {
  if (!idempotencyKey) return null
  const found = await findSuccessfulInvocation(grant, idempotencyKey, digest)
  if (found?.conflict) throw new ToolError('This idempotency_key was already used for different request data.')
  return found?.result ?? null
}
