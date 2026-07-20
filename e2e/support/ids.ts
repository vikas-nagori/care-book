// Fixed IDs for baseline seed data so seeding is idempotent and specs can reference known rows.

export const SEED = {
  /** Patient in Clinic A with a package + payment history. */
  patientAsha: '00000000-0000-4000-b000-000000000001',
  /** Second patient in Clinic A. */
  patientRavi: '00000000-0000-4000-b000-000000000002',
  /** Patient in Clinic B (tenant-isolation checks). */
  patientClinicB: '00000000-0000-4000-b000-0000000000b1',
  /** Active prepaid package on patientAsha — created_at is a real timestamptz (the original bug). */
  packageAsha: '00000000-0000-4000-c000-000000000001',
} as const
