import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDurationInput } from './duration.ts'

test('a blank duration means the default 45 minutes', () => {
  assert.deepEqual(parseDurationInput(''), { ok: true, minutes: 45 })
  assert.deepEqual(parseDurationInput('  '), { ok: true, minutes: 45 })
  assert.deepEqual(parseDurationInput(null), { ok: true, minutes: 45 })
})

test('a whole number of minutes in range is kept', () => {
  assert.deepEqual(parseDurationInput('50'), { ok: true, minutes: 50 })
  assert.deepEqual(parseDurationInput('1'), { ok: true, minutes: 1 })
  assert.deepEqual(parseDurationInput('1440'), { ok: true, minutes: 1440 })
})

test('0, negative, fractional, too long or non-numeric durations are refused, never turned into 45 (G-17c)', () => {
  for (const raw of ['0', '-5', '1.5', '1441', 'abc']) {
    const result = parseDurationInput(raw)
    assert.equal(result.ok, false, raw)
    if (!result.ok) assert.match(result.message, /Duration must be/)
  }
})
