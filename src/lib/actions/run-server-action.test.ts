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
