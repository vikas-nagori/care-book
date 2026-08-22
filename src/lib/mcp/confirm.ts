import { ToolError } from './errors.ts'

export function isConfirmed(args: Record<string, unknown>): boolean {
  return args.confirm === true
}

export function requireIdempotencyKey(args: Record<string, unknown>): string {
  const key = typeof args.idempotency_key === 'string' ? args.idempotency_key.trim() : ''
  if (!key) throw new ToolError('idempotency_key is required for billing writes.')
  if (key.length > 200) throw new ToolError('idempotency_key must be 200 characters or fewer.')
  return key
}

export function dryRun(action: string, preview: Record<string, unknown>) {
  return { dry_run: true, action, preview }
}
