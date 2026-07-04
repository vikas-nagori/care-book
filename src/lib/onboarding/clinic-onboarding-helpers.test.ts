import assert from 'node:assert/strict'
import test from 'node:test'

import { validateClinicOnboardingInput } from './clinic-onboarding-helpers.ts'

test('validateClinicOnboardingInput normalizes a valid request', () => {
  const result = validateClinicOnboardingInput({
    clinicName: '  Restore Physio  ',
    ownerFullName: '  Asha Patel  ',
    ownerEmail: ' Owner@Example.com ',
    ownerMobileNumber: ' 9876543210 ',
    clinicPhone: ' 022-123456 ',
    clinicAddress: '  Bandra  ',
  })

  assert.deepEqual(result, {
    success: true,
    values: {
      clinicName: 'Restore Physio',
      ownerFullName: 'Asha Patel',
      ownerEmail: 'owner@example.com',
      ownerMobileNumber: '9876543210',
      clinicPhone: '022-123456',
      clinicAddress: 'Bandra',
    },
  })
})

test('validateClinicOnboardingInput requires clinic name before owner details', () => {
  const result = validateClinicOnboardingInput({
    clinicName: ' ',
    ownerFullName: '',
    ownerEmail: 'bad',
    ownerMobileNumber: '',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'CLINIC_ONBOARDING_MISSING_CLINIC',
    message: 'Enter the clinic name.',
  })
})

test('validateClinicOnboardingInput rejects invalid owner email', () => {
  const result = validateClinicOnboardingInput({
    clinicName: 'Restore Physio',
    ownerFullName: 'Asha Patel',
    ownerEmail: 'not-an-email',
    ownerMobileNumber: '9876543210',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'CLINIC_ONBOARDING_INVALID_EMAIL',
    message: 'Enter a valid owner email address.',
  })
})
