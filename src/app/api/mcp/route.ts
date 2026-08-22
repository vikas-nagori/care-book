import { NextResponse, type NextRequest } from 'next/server'
import { isMcpEnabled, mcpOrigin } from '@/lib/mcp/config'
import { buildToolContext } from '@/lib/mcp/context'
import { sanitizeToolError } from '@/lib/mcp/errors'
import { resolveBearer } from '@/lib/mcp/grants'
import { isNotification, parseJsonRpc, rpcError, rpcResult, toolResult } from '@/lib/mcp/jsonrpc'
import { createRegistry } from '@/lib/mcp/registry'
import { logger } from '@/lib/logger'
import { identityTools } from '@/lib/mcp/tools/identity'
import { patientReadTools, patientWriteTools } from '@/lib/mcp/tools/patients'
import { appointmentReadTools, appointmentWriteTools, sessionReadTools } from '@/lib/mcp/tools/appointments'
import { referenceTools } from '@/lib/mcp/tools/reference'
import { billingWriteTools } from '@/lib/mcp/tools/billing-writes'
import { enforceRateLimit } from '@/lib/mcp/rate-limit'
import { recordInvocation, requestDigest } from '@/lib/mcp/audit'
import { replaySuccessfulCall } from '@/lib/mcp/idempotency'

const PROTOCOL_VERSION = '2024-11-05'
const registry = createRegistry([
  ...identityTools,
  ...patientReadTools,
  ...patientWriteTools,
  ...appointmentReadTools,
  ...appointmentWriteTools,
  ...sessionReadTools,
  ...referenceTools,
  ...billingWriteTools,
])

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized' },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${mcpOrigin()}/.well-known/oauth-protected-resource"`,
        'Cache-Control': 'no-store',
      },
    }
  )
}

export async function GET() {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  return unauthorized()
}

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) return unauthorized()

  const grant = await resolveBearer(token)
  if (!grant) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'))
  }
  const rpc = parseJsonRpc(body)
  if (!rpc) return NextResponse.json(rpcError(null, -32600, 'Invalid Request'))
  if (rpc.method === 'notifications/initialized') return new NextResponse(null, { status: 202 })

  const id = rpc.id ?? null
  try {
    if (rpc.method === 'initialize') {
      return NextResponse.json(rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'care-book', version: '1.0.0' },
      }))
    }

    const context = await buildToolContext(grant)
    if (!context) return NextResponse.json(rpcError(id, -32603, 'Profile unavailable'))

    if (rpc.method === 'tools/list') {
      return NextResponse.json(rpcResult(id, {
        tools: registry.visibleTools(grant, context.profile).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      }))
    }

    if (rpc.method === 'tools/call') {
      const params = (rpc.params && typeof rpc.params === 'object' ? rpc.params : {}) as { name?: unknown; arguments?: unknown }
      const name = typeof params.name === 'string' ? params.name : ''
      const tool = registry.findTool(name)
      const allowed = tool ? registry.visibleTools(grant, context.profile).includes(tool) : false
      if (!tool || !allowed) return NextResponse.json(rpcResult(id, toolResult(`Unknown or unavailable tool: ${name}`, true)))
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {}
      const digest = requestDigest(tool.name, args)
      const idempotencyKey = typeof args.idempotency_key === 'string' ? args.idempotency_key.trim() : null
      if (tool.scope === 'write:billing' && idempotencyKey) {
        const replay = await replaySuccessfulCall(grant, idempotencyKey, digest)
        if (replay !== null) return NextResponse.json(rpcResult(id, toolResult(JSON.stringify(replay, null, 2))))
      }
      const startedAt = Date.now()
      try {
        enforceRateLimit(grant.grantId, tool.scope)
        const value = await tool.handler(args, context)
        const status = value && typeof value === 'object' && (value as Record<string, unknown>).dry_run === true ? 'dry_run' : 'ok'
        await recordInvocation({
          grant,
          toolName: tool.name,
          idempotencyKey,
          digest,
          status,
          result: status === 'ok' && tool.scope === 'write:billing' ? value : undefined,
          entityType: context.auditEntity?.type,
          entityId: context.auditEntity?.id,
          durationMs: Date.now() - startedAt,
        })
        return NextResponse.json(rpcResult(id, toolResult(JSON.stringify(value, null, 2))))
      } catch (error) {
        try {
          await recordInvocation({ grant, toolName: tool.name, idempotencyKey, digest, status: 'error', errorCode: 'MCP_TOOL_FAILED', durationMs: Date.now() - startedAt })
        } catch (auditError) {
          logger.error('mcp/audit/failed', auditError, { tool: tool.name, grantId: grant.grantId })
        }
        logger.warn('mcp/tool/failed', 'An MCP tool call failed', { tool: tool.name, grantId: grant.grantId })
        return NextResponse.json(rpcResult(id, toolResult(sanitizeToolError(error), true)))
      }
    }

    return NextResponse.json(rpcError(id, -32601, `Method not found: ${rpc.method}`))
  } catch (error) {
    logger.error('mcp/rpc/unexpected', error, { method: rpc.method, grantId: grant.grantId })
    return NextResponse.json(rpcError(id, -32603, 'Internal error'))
  } finally {
    if (isNotification(rpc)) logger.info('mcp/rpc', 'Handled a notification', { method: rpc.method })
  }
}
