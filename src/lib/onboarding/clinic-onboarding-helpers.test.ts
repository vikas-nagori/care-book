import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildClinicOnboardingFingerprint,
  getOnboardingThrottleWindowStart,
  validateClinicOnboardingInput,
} from './clinic-onboarding-helpers.ts'

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

test('validateClinicOnboardingInput rejects owner mobile numbers that are not 10 digits', () => {
  const result = validateClinicOnboardingInput({
    clinicName: 'Restore Physio',
    ownerFullName: 'Asha Patel',
    ownerEmail: 'owner@example.com',
    ownerMobileNumber: '987654321',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'CLINIC_ONBOARDING_INVALID_MOBILE',
    message: 'Enter a 10 digit owner mobile number.',
  })
})

test('buildClinicOnboardingFingerprint is stable across whitespace and casing', () => {
  assert.equal(
    buildClinicOnboardingFingerprint({
      clinicName: '  Restore Physio ',
      ownerEmail: ' OWNER@EXAMPLE.COM ',
      ownerMobileNumber: ' 9876543210 ',
      requestIp: '203.0.113.10',
    }),
    buildClinicOnboardingFingerprint({
      clinicName: 'restore physio',
      ownerEmail: 'owner@example.com',
      ownerMobileNumber: '9876543210',
      requestIp: '203.0.113.10',
    })
  )
})

test('getOnboardingThrottleWindowStart returns a UTC ISO timestamp for the lookback window', () => {
  assert.equal(
    getOnboardingThrottleWindowStart(new Date('2026-07-07T10:30:00.000Z'), 15),
    '2026-07-07T10:15:00.000Z'
  )
})
