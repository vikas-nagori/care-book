import assert from 'node:assert/strict'
import test from 'node:test'

import { isNotification, parseJsonRpc, rpcError, rpcResult, toolResult } from './jsonrpc.ts'

test('a valid request parses', () => {
  assert.equal(parseJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })?.method, 'tools/list')
})

test('a wrong jsonrpc version is rejected', () => {
  assert.equal(parseJsonRpc({ jsonrpc: '1.0', id: 1, method: 'x' }), null)
  assert.equal(parseJsonRpc({ id: 1, method: 'x' }), null)
  assert.equal(parseJsonRpc(null), null)
})

test('a request without an id is a notification', () => {
  assert.equal(isNotification({ jsonrpc: '2.0', method: 'notifications/initialized' }), true)
  assert.equal(isNotification({ jsonrpc: '2.0', id: 0, method: 'tools/list' }), false)
})

test('results and errors carry the request id', () => {
  assert.deepEqual(rpcResult(7, { ok: true }), { jsonrpc: '2.0', id: 7, result: { ok: true } })
  assert.deepEqual(rpcError(7, -32601, 'nope'), {
    jsonrpc: '2.0',
    id: 7,
    error: { code: -32601, message: 'nope' },
  })
})

test('a tool result wraps text in MCP content blocks', () => {
  assert.deepEqual(toolResult('hello'), { content: [{ type: 'text', text: 'hello' }], isError: false })
  assert.equal(toolResult('boom', true).isError, true)
})
