import { ToolError } from './errors.ts'

const calls = new Map<string, number[]>()
const limits = {
  read: { windowMs: 60_000, max: 60 },
  clinical: { windowMs: 60_000, max: 10 },
  billing: { windowMs: 60 * 60_000, max: 20 },
} as const

export function enforceRateLimit(grantId: string, scope: 'read' | 'write:clinical' | 'write:billing') {
  const kind = scope === 'read' ? 'read' : scope === 'write:clinical' ? 'clinical' : 'billing'
  const limit = limits[kind]
  const now = Date.now()
  const key = `${grantId}:${kind}`
  const recent = (calls.get(key) ?? []).filter((timestamp) => now - timestamp < limit.windowMs)
  if (recent.length >= limit.max) throw new ToolError('Too many MCP requests. Please try again shortly.')
  recent.push(now)
  calls.set(key, recent)
}
