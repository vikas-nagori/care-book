// Fixed IDs for baseline seed data so seeding is idempotent and specs can reference known rows.

export const SEED = {
  /** Disposable coordination fixture with private clinical/billing fields. */
  patientExternal: '00000000-0000-4000-b000-000000000010',
  appointmentExternal: '00000000-0000-4000-d000-000000000010',
  /** Patient in Clinic A with a package + payment history. */
  patientAsha: '00000000-0000-4000-b000-000000000001',
  /** Second patient in Clinic A. */
  patientRavi: '00000000-0000-4000-b000-000000000002',
  /** Patient in Clinic B (tenant-isolation checks). */
  patientClinicB: '00000000-0000-4000-b000-0000000000b1',
  /** Clinic A patient with a completed unpaid session. */
  patientPaymentDue: '00000000-0000-4000-b000-000000000003',
  /** Active prepaid package on patientAsha — created_at is a real timestamptz (the original bug). */
  packageAsha: '00000000-0000-4000-c000-000000000001',
  /** Reusable package template in Clinic A. */
  packageTemplate: '00000000-0000-4000-c000-000000000002',
  /** Shared Clinic A appointment visible to all Clinic A staff. */
  appointmentShared: '00000000-0000-4000-d000-000000000001',
  /** Rolling future shared appointment that keeps the dashboard Up next contract deterministic. */
  appointmentDashboardNext: '00000000-0000-4000-d000-000000000004',
  /** Private Clinic A appointment owned and assigned to STAFF2. */
  appointmentStaff2Private: '00000000-0000-4000-d000-000000000002',
  /** Clinic B appointment used for tenant-isolation checks. */
  appointmentClinicB: '00000000-0000-4000-d000-0000000000b1',
  /** Completed unpaid appointment backing the payment-due detail route. */
  appointmentPaymentDue: '00000000-0000-4000-d000-000000000003',
  /** Payment history row for patientAsha's prepaid package. */
  paymentAsha: '00000000-0000-4000-e000-000000000001',
  /** Pending request shown in the platform onboarding queue. */
  onboardingPending: '00000000-0000-4000-f000-000000000001',

  // Sparse fixtures (plan F3): every optional column NULL, so route smoke and every screen that
  // lists them render NULL-bearing rows. Never edit or delete them in a spec; build a factory
  // row instead. Dated away from the windows count-sensitive specs assert on.
  /** Clinic A patient with a name and nothing else (phone, email, age, gender, address… NULL). */
  patientSparse: '00000000-0000-4000-b000-000000000020',
  /** Completed shared-type appointment on patientSparse, 120 days ago: notes NULL, fee NULL. */
  appointmentSparse: '00000000-0000-4000-d000-000000000020',
  /** Session note on appointmentSparse with all five SOAP fields NULL. */
  sessionNoteSparse: '00000000-0000-4000-8000-000000000020',
  /** Treatment plan on patientSparse with only a diagnosis and a start date. */
  treatmentPlanSparse: '00000000-0000-4000-8100-000000000020',
  /** Ordinary payment on patientSparse, 120 days ago, notes NULL. */
  paymentSparse: '00000000-0000-4000-e000-000000000020',
  /** Legacy package on patientSparse: billing_version 1, NULL appointment type and start date. */
  packageSparse: '00000000-0000-4000-c000-000000000020',
  /** Pending reminder dated today (re-dated by every seed) with only a title. */
  reminderSparse: '00000000-0000-4000-8200-000000000020',
  /** Temporary Staff with email and notes NULL. */
  externalStaffSparse: '00000000-0000-4000-8300-000000000020',
  /** Pending Staff invite with no email (mobile-number sign-in). */
  inviteMobileOnly: '00000000-0000-4000-8400-000000000021',
  /** Pending invite from before names and mobile numbers: email only, full_name NULL. */
  inviteLegacy: '00000000-0000-4000-8400-000000000022',
  /** Revoked invite. */
  inviteRevoked: '00000000-0000-4000-8400-000000000023',
  /** Referring doctor with specialty and address NULL. */
  doctorSparse: '00000000-0000-4000-8500-000000000020',
  /** Name-only Clinic A patient referred by doctorSparse. */
  patientReferredByDoctor: '00000000-0000-4000-b000-000000000021',
  /** Pending clinic request with clinic phone and address NULL. */
  onboardingPendingSparse: '00000000-0000-4000-f000-000000000020',
  /** Name-only Clinic A patient shared with EXTERNAL. */
  patientExternalSparse: '00000000-0000-4000-b000-000000000022',
  /** External Staff appointment on patientExternalSparse, today 07:00: notes NULL, fee NULL. */
  appointmentExternalSparse: '00000000-0000-4000-d000-000000000022',
  /** External Staff appointment on patientExternalSparse, yesterday, still scheduled (read-only). */
  externalApptYesterday: '00000000-0000-4000-d000-000000000023',
  /** External Staff appointment on patientExternalSparse, two days ago, completed (read-only). */
  externalApptCompleted: '00000000-0000-4000-d000-000000000024',
  /** Package in Clinic B (tenant isolation). */
  packageClinicB: '00000000-0000-4000-c000-0000000000b1',
} as const

/**
 * Sparse Clinic A staff accounts (plan F3). Auth IDs are assigned by GoTrue, so look them up by
 * mobile number (`profiles.mobile_number`). Neither signs in during the suite.
 */
export const SPARSE_PROFILES = {
  /** Active staff with email NULL (mobile-number sign-in only). */
  mobileOnly: { mobile: '9000000011', email: null, fullName: 'Sparse Mobile Staff' },
  /** Active staff with full_name NULL. */
  nameless: { mobile: '9000000012', email: 'nameless-staff@carebook.test', fullName: null },
} as const

/** Contact details of the sparse fixtures, for specs that need to find them on screen. */
export const SPARSE_NAMES = {
  patient: 'Sparse Name Only',
  patientReferredByDoctor: 'Sparse Referred Patient',
  patientExternal: 'Sparse External Patient',
  doctor: 'Sparse Doctor',
  packageLegacy: 'Sparse Legacy Package',
  packageClinicB: 'Clinic B Package',
  treatmentPlanDiagnosis: 'Sparse diagnosis',
  reminderTitle: 'Sparse reminder',
  externalStaff: 'Sparse Temp Staff',
  externalStaffPhone: '9000000031',
  inviteMobileOnly: { mobile: '9000000021', fullName: 'Sparse Mobile Invitee' },
  inviteLegacy: { email: 'legacy-invitee@carebook.test' },
  inviteRevoked: { email: 'revoked-invitee@carebook.test', mobile: '9000000023', fullName: 'Sparse Revoked Invitee' },
  onboardingClinic: 'E2E Sparse Pending Clinic',
  onboardingOwnerEmail: 'sparse-pending-owner@carebook.test',
} as const
