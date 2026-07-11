import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPackageTemplate, validatePackageTemplateInput } from './package-template.ts'
import type { PackageTemplate } from '../supabase/types.ts'

test('validatePackageTemplateInput accepts and trims a valid template', () => {
  const result = validatePackageTemplateInput({
    name: '  10-session package  ',
    minSessions: 10,
    perSessionAmount: 800,
  })

  assert.deepEqual(result, {
    success: true,
    values: { name: '10-session package', minSessions: 10, perSessionAmount: 800 },
  })
})

test('validatePackageTemplateInput requires a name', () => {
  const result = validatePackageTemplateInput({ name: '   ', minSessions: 10, perSessionAmount: 800 })
  assert.equal(result.success, false)
  assert.equal((result as { errorCode: string }).errorCode, 'PACKAGE_TEMPLATE_NAME_REQUIRED')
})

test('validatePackageTemplateInput rejects non-positive or fractional sessions', () => {
  assert.equal(validatePackageTemplateInput({ name: 'x', minSessions: 0, perSessionAmount: 800 }).success, false)
  assert.equal(validatePackageTemplateInput({ name: 'x', minSessions: 2.5, perSessionAmount: 800 }).success, false)
})

test('validatePackageTemplateInput rejects a negative rate', () => {
  const result = validatePackageTemplateInput({ name: 'x', minSessions: 10, perSessionAmount: -1 })
  assert.equal(result.success, false)
  assert.equal((result as { errorCode: string }).errorCode, 'PACKAGE_TEMPLATE_INVALID_AMOUNT')
})

test('applyPackageTemplate maps a template onto the billing form fields', () => {
  const template: PackageTemplate = {
    id: 'tmpl-1',
    clinic_id: 'clinic-1',
    name: '10-session package',
    min_sessions: 10,
    per_session_amount: 800,
    created_at: '2026-01-01T00:00:00Z',
  }

  assert.deepEqual(applyPackageTemplate(template), {
    name: '10-session package',
    sessions: '10',
    perSessionAmount: '800',
  })
})
