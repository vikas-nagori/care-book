import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_PATH,
  isPasswordRecoveryCallback,
  passwordRecoveryCookie,
  resolveUpdatePasswordAccess,
  sessionIdFromAccessToken,
} from './password-recovery.ts'

function token(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`
}

test('a reset link is recognised by its type or by where it continues to', () => {
  assert.equal(isPasswordRecoveryCallback({ type: 'recovery', nextPath: '/auth/complete-invite' }), true)
  assert.equal(isPasswordRecoveryCallback({ type: null, nextPath: PASSWORD_RECOVERY_PATH }), true)
  assert.equal(isPasswordRecoveryCallback({ type: 'invite', nextPath: '/auth/complete-invite' }), false)
  assert.equal(isPasswordRecoveryCallback({ type: null, nextPath: '/auth/complete-invite' }), false)
})

test('sessionIdFromAccessToken reads the session_id claim and nothing else', () => {
  assert.equal(sessionIdFromAccessToken(token({ sub: 'u', session_id: 'c746fc33-294d-4935-9311-8716b87b5d92' })), 'c746fc33-294d-4935-9311-8716b87b5d92')
  // base64url characters and missing padding survive the decode.
  assert.equal(sessionIdFromAccessToken(token({ session_id: 'sess-?>?>', x: 'ÿÿ' })), 'sess-?>?>')
  for (const bad of [null, undefined, '', 'not-a-jwt', 'a.!!!.c', token({ sub: 'u' }), token({ session_id: 42 }), token({ session_id: '' })]) {
    assert.equal(sessionIdFromAccessToken(bad), null, String(bad))
  }
})

test('the marker cookie is httpOnly, scoped to the page and short-lived', () => {
  assert.deepEqual(passwordRecoveryCookie('session-1', true), {
    name: PASSWORD_RECOVERY_COOKIE,
    value: 'session-1',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: PASSWORD_RECOVERY_PATH,
    maxAge: 3600,
  })
  assert.equal(passwordRecoveryCookie('session-1', false).secure, false)
})

test('only the session the reset link created may use the page (decision D4d)', () => {
  const base = { isPlatformAdmin: false, role: 'staff' as const }
  assert.equal(resolveUpdatePasswordAccess({ ...base, markedSessionId: 's1', currentSessionId: 's1' }), 'allow')
  assert.equal(resolveUpdatePasswordAccess({ ...base, markedSessionId: 's1', currentSessionId: 's2' }), '/settings')
  assert.equal(resolveUpdatePasswordAccess({ ...base, markedSessionId: undefined, currentSessionId: 's1' }), '/settings')
  assert.equal(resolveUpdatePasswordAccess({ ...base, markedSessionId: 's1', currentSessionId: null }), '/settings')
  assert.equal(resolveUpdatePasswordAccess({ ...base, markedSessionId: '', currentSessionId: '' }), '/settings')
})

test('anyone else lands where they can change a password the normal way', () => {
  const direct = { markedSessionId: null, currentSessionId: 's1' }
  assert.equal(resolveUpdatePasswordAccess({ ...direct, isPlatformAdmin: false, role: 'admin' }), '/settings')
  assert.equal(resolveUpdatePasswordAccess({ ...direct, isPlatformAdmin: false, role: 'staff' }), '/settings')
  assert.equal(resolveUpdatePasswordAccess({ ...direct, isPlatformAdmin: false, role: 'external_staff' }), '/external/account')
  assert.equal(resolveUpdatePasswordAccess({ ...direct, isPlatformAdmin: true, role: 'admin' }), '/platform')
  // No readable profile: Settings, where the middleware routes the account as usual.
  assert.equal(resolveUpdatePasswordAccess({ ...direct, isPlatformAdmin: false, role: null }), '/settings')
})
