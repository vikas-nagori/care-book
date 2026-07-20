// Fixed IDs for baseline seed data so seeding is idempotent and specs can reference known rows.

export const SEED = {
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
} as const
