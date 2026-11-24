import assert from 'node:assert/strict'
import test from 'node:test'

import { runServerAction, STALE_DEPLOYMENT_MESSAGE, ACTION_UNREACHABLE_MESSAGE } from './run-server-action.ts'

function harness(isStale = false) {
  const calls: string[] = []
  return {
    calls,
    deps: {
      isStaleDeployment: () => isStale,
      rethrowFrameworkError: (error: unknown) => {
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error
      },
      onStaleDeployment: () => calls.push('reload'),
      onFailure: (kind: string) => calls.push(`report:${kind}`),
    },
  }
}

test('passes a resolved action result straight through', async () => {
  const { deps, calls } = harness()
  const result = await runServerAction(async () => ({ success: true as const, value: 7 }), deps)
  assert.deepEqual(result, { success: true, value: 7 })
  assert.deepEqual(calls, [])
})

// Incident 2026-11-24: a rejected createUserInvite left "Creating login…" spinning forever
// because the form awaited the action with no catch.
test('turns a rejected action into a failure result instead of throwing', async () => {
  const { deps, calls } = harness()
  const result = await runServerAction(async () => { throw new TypeError('Failed to fetch') }, deps)
  assert.deepEqual(result, { success: false, errorCode: 'CLIENT_ACTION_FAILED', message: ACTION_UNREACHABLE_MESSAGE })
  assert.deepEqual(calls, ['report:failed'])
})

test('a stale-deployment rejection reloads the app and says so', async () => {
  const { deps, calls } = harness(true)
  const result = await runServerAction(async () => { throw new Error('Server Action "abc" was not found') }, deps)
  assert.deepEqual(result, { success: false, errorCode: 'CLIENT_STALE_DEPLOYMENT', message: STALE_DEPLOYMENT_MESSAGE })
  assert.deepEqual(calls, ['report:stale', 'reload'])
})

test('framework control flow (redirects) is rethrown, not swallowed', async () => {
  const { deps } = harness()
  await assert.rejects(runServerAction(async () => { throw new Error('NEXT_REDIRECT') }, deps), /NEXT_REDIRECT/)
})

test('a caller can word the failure for its own action', async () => {
  const { deps } = harness()
  const result = await runServerAction(async () => { throw new TypeError('Failed to fetch') }, deps, {
    failureMessage: 'Unable to confirm this booking. Try again to check if it was saved.',
  })
  assert.deepEqual(result, {
    success: false,
    errorCode: 'CLIENT_ACTION_FAILED',
    message: 'Unable to confirm this booking. Try again to check if it was saved.',
  })
})

// A lost response does not mean the write didn't happen: telling people to just "try again"
// after a payment invites a duplicate. The default must send them to check first.
test('the default failure message never implies the action did not happen', () => {
  assert.match(ACTION_UNREACHABLE_MESSAGE, /refresh/i)
  assert.match(ACTION_UNREACHABLE_MESSAGE, /before trying again/i)
})
