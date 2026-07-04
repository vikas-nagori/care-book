import assert from 'node:assert/strict'
import test from 'node:test'

import {
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_LABEL,
  APPOINTMENT_TYPE_SHORT_LABEL,
  feeForType,
  isHomeVisitType,
} from './appointment-type.ts'
import type { GlobalSettings } from '../supabase/types.ts'

const settings: GlobalSettings = {
  id: 1,
  clinic_fee: 500,
  home_visit_fee: 800,
}

test('every appointment type has a full and short label', () => {
  for (const type of APPOINTMENT_TYPES) {
    assert.ok(APPOINTMENT_TYPE_LABEL[type], `missing full label for ${type}`)
    assert.ok(APPOINTMENT_TYPE_SHORT_LABEL[type], `missing short label for ${type}`)
  }
})

test('home visits count as home visit types', () => {
  assert.equal(isHomeVisitType('home_visit'), true)
  assert.equal(isHomeVisitType('clinic'), false)
})

test('feeForType picks the matching fee per type', () => {
  assert.equal(feeForType(settings, 'clinic'), 500)
  assert.equal(feeForType(settings, 'home_visit'), 800)
})
