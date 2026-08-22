export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

export function parseJsonRpc(value: unknown): JsonRpcRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.jsonrpc !== '2.0') return null
  if (typeof candidate.method !== 'string' || candidate.method.length === 0) return null
  return candidate as JsonRpcRequest
}

export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined || request.id === null
}

export function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}
