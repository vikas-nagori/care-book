// Every place the app writes, and the three e2e tests that protect it (plan F6).
//
// mutation-manifest.test.ts discovers every mutation surface in src/ (mutation-inventory.ts) and
// fails unless this list matches it exactly, so a new server action, form action, direct Supabase
// write or POST to /api cannot ship without an entry. Each entry names:
//
//   happy    a test that performs the mutation and checks the result;
//   minimal  a test that submits only the required fields and then runs expectNoLeakedNulls on
//            the screens that render the record;
//   failure  a test that makes the request fail (failNextServerAction / failNextSupabaseCall;
//            for `fetch` surfaces a `page.route` fault also counts) and proves the control
//            recovers.
//
// Each is `{ spec, title }` (the spec path under e2e/ and the exact test title), `{ exempt }`
// with a reason, or — while MUTATION_MANIFEST_ALLOW_TODO is true (Phase 1 only) —
// `{ todo: '<package>' }`. Phase 2 (L8) flips the flag to false.
//
// HOW A PHASE 1 PACKAGE UPDATES THIS FILE
//   Edit only the block between your package's BEGIN/END markers; every other block belongs to
//   another branch and editing it creates merge conflicts. To replace a todo, write the test, then
//   change e.g. `failure: todo('schedule')` to
//   `failure: { spec: 'e2e/shared/server-action-failures.spec.ts', title: '<exact test title>' }`.
//   Use a literal test title (no template). Run `npm run test:e2e:support` to check it.
//   If an entry you need is in another package's block, ask that package's owner.

export type PhaseOnePackage =
  | 'patients'
  | 'schedule'
  | 'billing'
  | 'settings-auth'
  | 'external'
  | 'platform-http'
  | 'mobile'

export type MutationKind = 'server-action' | 'form-action' | 'supabase' | 'fetch'

export type TestRef = { spec: string; title: string }
export type Coverage = TestRef | { exempt: string } | { todo: PhaseOnePackage }

export type MutationEntry = {
  id: string
  kind: MutationKind
  happy: Coverage
  minimal: Coverage
  failure: Coverage
}

/** Code that no user can reach. Phase 2 deletes it or wires it up (L8). */
export type UnusedEntry = {
  id: string
  kind: MutationKind
  unused: true
  reason: string
  /** For a surface that is still discovered: a pattern that must match nowhere in src/. */
  noMatch?: string
}

export type ManifestEntry = MutationEntry | UnusedEntry

/** Phase 1 only. Phase 2 (L8) sets this to false; from then on every entry must name real tests. */
export const MUTATION_MANIFEST_ALLOW_TODO = true

const todo = (pkg: PhaseOnePackage) => ({ todo: pkg }) as const
const ref = (spec: string, title: string): TestRef => ({ spec, title })

// The OAuth consent screen and Connected Apps are switched off in the e2e environment (decision
// D3). Their routes are covered by *.route.test.ts in Phase 2 (L6).
const D3_EXEMPT = { exempt: 'D3: OAuth consent and Connected Apps are disabled in e2e; covered by route tests (Phase 2 L6)' } as const

// ============================================================================================
// BEGIN patients (plan 5.1, branch test/e2e-patients) — edit only inside this block
// ============================================================================================
const PATIENTS: readonly ManifestEntry[] = [
  {
    id: 'supabase:patients.insert@src/app/patients/patient-form.tsx',
    kind: 'supabase',
    happy: ref('e2e/shared/patients.spec.ts', 'creates a representative patient and finds the exact row through list search'),
    minimal: ref('e2e/shared/minimal-input.spec.ts', 'a patient saved with only a name renders on every patient screen'),
    failure: todo('patients'),
  },
  {
    id: 'supabase:patients.update@src/app/patients/patient-form.tsx',
    kind: 'supabase',
    happy: ref('e2e/shared/patients.spec.ts', 'edits a factory-owned patient and shows the persisted fields on detail and list'),
    minimal: todo('patients'),
    failure: todo('patients'),
  },
  {
    id: 'supabase:treatment_plans.insert@src/app/patients/[id]/treatment-plan-form.tsx',
    kind: 'supabase',
    happy: todo('patients'),
    minimal: ref('e2e/shared/minimal-input.spec.ts', 'a treatment plan with only its required fields renders on the Plans tab'),
    failure: todo('patients'),
  },
  {
    id: 'supabase:doctors.insert@src/components/referral/referral-fields.tsx',
    kind: 'supabase',
    happy: todo('patients'),
    minimal: todo('patients'),
    failure: todo('patients'),
  },
  {
    id: 'src/app/patients/actions.ts#deletePatient@src/app/patients/[id]/patient-detail.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/patient-delete.spec.ts', 'admin deletes an empty patient after typing the name to confirm'),
    minimal: todo('patients'),
    failure: todo('patients'),
  },
  {
    id: 'src/app/patients/actions.ts#savePatientExternalAccess@src/app/patients/[id]/patient-external-access.tsx',
    kind: 'server-action',
    happy: ref('e2e/external/coordination.spec.ts', 'admin multi-select shares patient basics with a second external account and revocation removes access'),
    minimal: todo('patients'),
    failure: todo('patients'),
  },
]
// END patients ================================================================================

// ============================================================================================
// BEGIN schedule (plan 5.2, branch test/e2e-schedule) — edit only inside this block
// ============================================================================================
const SCHEDULE: readonly ManifestEntry[] = [
  {
    id: 'fetch:POST /api/appointments/bookings[…]@src/app/schedule/appointment-form.tsx',
    kind: 'fetch',
    happy: ref('e2e/shared/schedule-write-flows.spec.ts', 'books a shared appointment through the real appointment form'),
    minimal: ref('e2e/shared/minimal-input.spec.ts', 'an appointment booked with only required fields renders on schedule, detail and dashboard'),
    failure: ref('e2e/shared/appointment-recovery.spec.ts', 'an outage that outlasts automatic resends unlocks Retry same booking with the exact original request'),
  },
  {
    id: 'supabase:appointments.update@src/app/schedule/appointment-form.tsx',
    kind: 'supabase',
    happy: todo('schedule'),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/schedule/actions.ts#updateAppointmentStatus@src/app/schedule/[id]/appointment-detail.tsx',
    kind: 'server-action',
    happy: ref('e2e/shared/schedule-write-flows.spec.ts', 'changes appointment status from scheduled to completed and persists it'),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/schedule/actions.ts#deleteAppointment@src/app/schedule/[id]/appointment-detail.tsx',
    kind: 'server-action',
    happy: ref('e2e/shared/schedule-write-flows.spec.ts', 'deletes a scheduled appointment through confirmation and redirects away'),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/billing/actions.ts#adjustAppointmentFee@src/app/schedule/[id]/appointment-detail.tsx',
    kind: 'server-action',
    happy: todo('schedule'),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/schedule/actions.ts#saveSessionNote@src/app/schedule/[id]/session-note-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/shared/schedule-write-flows.spec.ts', 'adds a SOAP session note, reopens it, and persists edited content'),
    minimal: ref('e2e/shared/minimal-input.spec.ts', 'an all-blank session note saves and renders'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/schedule/reminder-actions.ts#createReminder@src/app/schedule/reminder-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/shared/reminders.spec.ts', 'manages inquiry and patient reminders without changing appointments'),
    minimal: ref('e2e/shared/minimal-input.spec.ts', 'a reminder with only a title and date renders on the schedule and dashboard'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/schedule/reminder-actions.ts#updateReminder@src/app/schedule/reminder-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/shared/reminders.spec.ts', 'manages inquiry and patient reminders without changing appointments'),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/schedule/reminder-actions.ts#setReminderStatus@src/app/schedule/reminder-dialog.tsx',
    kind: 'server-action',
    happy: ref('e2e/shared/reminders.spec.ts', 'manages inquiry and patient reminders without changing appointments'),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/schedule/reminder-actions.ts#deleteReminder@src/app/schedule/reminder-dialog.tsx',
    kind: 'server-action',
    happy: ref('e2e/shared/reminders.spec.ts', "keeps pending reminders on today's schedule until they are completed or deleted"),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/dashboard-actions.ts#getDashboardAppointmentOptions@src/app/dashboard-new-appointment.tsx',
    kind: 'server-action',
    happy: todo('schedule'),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
  {
    id: 'src/app/dashboard-actions.ts#getDashboardReminderPatients@src/app/dashboard-reminders.tsx',
    kind: 'server-action',
    happy: todo('schedule'),
    minimal: todo('schedule'),
    failure: todo('schedule'),
  },
]
// END schedule ================================================================================

// ============================================================================================
// BEGIN billing (plan 5.3, branch test/e2e-billing) — edit only inside this block
// ============================================================================================
const BILLING: readonly ManifestEntry[] = [
  {
    id: 'src/app/billing/actions.ts#recordPayment@src/app/billing/billing-entry-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/billing-packages.spec.ts', 'records a payment, allocates the unpaid session, and shows the timeline entry'),
    minimal: ref('e2e/admin/minimal-input.spec.ts', 'a payment recorded without notes renders in billing and on the patient'),
    failure: todo('billing'),
  },
  {
    id: 'src/app/billing/actions.ts#createBillingEntry@src/app/billing/billing-entry-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/billing-packages.spec.ts', 'creates a prepaid package with payment from the seeded template prefill, without notes'),
    minimal: todo('billing'),
    failure: todo('billing'),
  },
  {
    id: 'src/app/billing/actions.ts#getOutstandingCharges@src/app/billing/billing-entry-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/billing-packages.spec.ts', 'records a payment, allocates the unpaid session, and shows the timeline entry'),
    minimal: todo('billing'),
    failure: todo('billing'),
  },
  {
    id: 'src/app/billing/actions.ts#voidPayment@src/app/billing/billing-view.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/billing-packages.spec.ts', 'voids a created payment through the audited correction UI'),
    minimal: todo('billing'),
    failure: todo('billing'),
  },
  {
    id: 'src/app/billing/actions.ts#cancelPackage@src/app/billing/billing-view.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/billing-packages.spec.ts', 'cancelling a package cancels its payment too, keeping both rows for the audit trail'),
    minimal: todo('billing'),
    failure: todo('billing'),
  },
  {
    id: 'src/app/billing/actions.ts#recordRefund@src/app/billing/billing-view.tsx',
    kind: 'server-action',
    happy: todo('billing'),
    minimal: todo('billing'),
    failure: todo('billing'),
  },
  {
    id: 'src/app/billing/actions.ts#voidRefund@src/app/billing/billing-view.tsx',
    kind: 'server-action',
    happy: todo('billing'),
    minimal: todo('billing'),
    failure: todo('billing'),
  },
  {
    id: 'fetch:POST /api/billing/payment-due/[patientId]/pdf@src/app/billing/payment-due/[patientId]/payment-due-pdf-dialog.tsx',
    kind: 'fetch',
    happy: ref('e2e/admin/billing-packages.spec.ts', 'generates a regular payment PDF from completed sessions and keeps it ready to share'),
    minimal: todo('billing'),
    failure: todo('billing'),
  },
]
// END billing =================================================================================

// ============================================================================================
// BEGIN settings-auth (plan 5.4, branch test/e2e-settings-auth) — edit only inside this block
// ============================================================================================
const SETTINGS_AUTH: readonly ManifestEntry[] = [
  {
    id: 'src/app/settings/actions.ts#updateGlobalSettings@src/app/settings/settings-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'updates clinic and home-visit fees and restores the singleton setting'),
    minimal: todo('settings-auth'),
    // The Phase 0 proof of the fault helpers (plan F8) drives this exact call site.
    failure: ref('e2e/admin/fault-injection-smoke.spec.ts', 'a tap on a stale build shows the update message, reloads and saves nothing'),
  },
  {
    id: 'src/app/settings/actions.ts#createAppointmentType@src/app/settings/appointment-types-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'creates, edits, and deletes an appointment type'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#updateAppointmentType@src/app/settings/appointment-types-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'creates, edits, and deletes an appointment type'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#deleteAppointmentType@src/app/settings/appointment-types-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'creates, edits, and deletes an appointment type'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#createPackageTemplate@src/app/settings/package-templates-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'creates, edits, and deletes a package template'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#updatePackageTemplate@src/app/settings/package-templates-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'creates, edits, and deletes a package template'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#deletePackageTemplate@src/app/settings/package-templates-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'creates, edits, and deletes a package template'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#createUserInvite@src/app/settings/invite-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'invites a user with a temp password, re-issues it, revokes it, and re-invites'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#createUserInvite@src/app/settings/external-staff-list.tsx',
    kind: 'server-action',
    happy: todo('settings-auth'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#createExternalStaff@src/app/settings/external-staff-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'creates temporary staff without sending an invite'),
    minimal: ref('e2e/admin/minimal-input.spec.ts', 'temporary staff added without an email renders in settings'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#issueInviteTempPassword@src/app/settings/user-invites-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'invites a user with a temp password, re-issues it, revokes it, and re-invites'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#revokeUserInvite@src/app/settings/user-invites-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'invites a user with a temp password, re-issues it, revokes it, and re-invites'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#changeOwnPassword@src/app/settings/change-password-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/public/auth-flows.spec.ts', 'changes the password from Settings with current-password verification, no email involved'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#logoutFromSettings@src/app/settings/account-summary.tsx',
    kind: 'form-action',
    happy: ref('e2e/public/auth-flows.spec.ts', 'changes the password from Settings with current-password verification, no email involved'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/settings/actions.ts#revokeConnectedMcpApp@src/app/settings/connected-apps.tsx',
    kind: 'form-action',
    happy: D3_EXEMPT,
    minimal: D3_EXEMPT,
    failure: D3_EXEMPT,
  },
  {
    id: 'src/app/oauth/authorize/actions.ts#approveConsent@src/app/oauth/authorize/consent-form.tsx',
    kind: 'form-action',
    happy: D3_EXEMPT,
    minimal: D3_EXEMPT,
    failure: D3_EXEMPT,
  },
  {
    id: 'src/app/oauth/authorize/actions.ts#denyConsent@src/app/oauth/authorize/consent-form.tsx',
    kind: 'form-action',
    happy: D3_EXEMPT,
    minimal: D3_EXEMPT,
    failure: D3_EXEMPT,
  },
  {
    id: 'src/app/auth/change-password/actions.ts#completeForcedPasswordChange@src/app/auth/change-password/change-password-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/admin/settings.spec.ts', 'an invited user signs in with the temp password and must set their own'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/auth/complete-invite/actions.ts#completeInvitedSignup@src/app/auth/complete-invite/complete-invite-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/public/auth-flows.spec.ts', 'completes a real pending invite and signs in with the new password'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'src/app/clinic-onboarding/actions.ts#createClinicOnboardingRequest@src/app/clinic-onboarding/clinic-onboarding-form.tsx',
    kind: 'server-action',
    happy: ref('e2e/public/auth-flows.spec.ts', 'submits a representative clinic onboarding request'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'supabase:auth.signInWithPassword@src/app/login/page.tsx',
    kind: 'supabase',
    happy: ref('e2e/public/auth-flows.spec.ts', 'shows invalid login and accepts valid credentials for a disposable local user'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'supabase:auth.resetPasswordForEmail@src/app/login/page.tsx',
    kind: 'supabase',
    happy: ref('e2e/public/auth-flows.spec.ts', 'requests a password reset through the real login UI'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
  {
    id: 'supabase:auth.updateUser@src/app/auth/update-password/update-password-form.tsx',
    kind: 'supabase',
    happy: ref('e2e/public/auth-flows.spec.ts', 'updates a password through a real local recovery action link'),
    minimal: todo('settings-auth'),
    failure: todo('settings-auth'),
  },
]
// END settings-auth ===========================================================================

// ============================================================================================
// BEGIN external (plan 5.5, branch test/e2e-external) — edit only inside this block
// ============================================================================================
const EXTERNAL: readonly ManifestEntry[] = [
  {
    id: 'src/app/external/actions.ts#createExternalAppointment@src/app/external/booking-dialog.tsx',
    kind: 'server-action',
    happy: ref('e2e/external/coordination.spec.ts', 'external booking permits hidden overlaps and appears in the admin calendar'),
    minimal: todo('external'),
    failure: todo('external'),
  },
  {
    id: 'src/app/external/actions.ts#updateExternalAppointment@src/app/external/appointment-dialog.tsx',
    kind: 'server-action',
    happy: ref('e2e/external/coordination.spec.ts', 'external staff reschedule and then cancel their own upcoming appointment'),
    minimal: todo('external'),
    failure: todo('external'),
  },
  {
    id: 'src/app/settings/actions.ts#logoutFromSettings@src/app/external/unavailable.tsx',
    kind: 'form-action',
    happy: todo('external'),
    minimal: todo('external'),
    failure: todo('external'),
  },
]
// END external ================================================================================

// ============================================================================================
// BEGIN platform-http (plan 5.6, branch test/e2e-platform-http) — edit only inside this block
// ============================================================================================
const PLATFORM_HTTP: readonly ManifestEntry[] = [
  {
    id: 'src/app/platform/clinic-requests/actions.ts#approveClinicOnboardingRequest@src/app/platform/clinic-requests/clinic-requests-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/platform/management.spec.ts', 'approves a request, issues a temp password, and walks the owner through first login'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
  {
    id: 'src/app/platform/clinic-requests/actions.ts#rejectClinicOnboardingRequest@src/app/platform/clinic-requests/clinic-requests-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/platform/management.spec.ts', 'rejects a separate disposable onboarding request without creating a clinic'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
  {
    id: 'src/app/platform/clinics/actions.ts#blockClinic@src/app/platform/clinics/clinics-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/platform/management.spec.ts', 'blocks and unblocks a disposable clinic and its auth user'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
  {
    id: 'src/app/platform/clinics/actions.ts#unblockClinic@src/app/platform/clinics/clinics-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/platform/management.spec.ts', 'blocks and unblocks a disposable clinic and its auth user'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
  {
    id: 'src/app/platform/users/actions.ts#blockUser@src/app/platform/users/users-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/platform/management.spec.ts', 'blocks and unblocks a disposable user in profile and local auth'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
  {
    id: 'src/app/platform/users/actions.ts#unblockUser@src/app/platform/users/users-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/platform/management.spec.ts', 'blocks and unblocks a disposable user in profile and local auth'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
  {
    id: 'src/app/platform/users/actions.ts#sendPasswordReset@src/app/platform/users/users-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/platform/management.spec.ts', 'sends a local password recovery request for a disposable user'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
  {
    id: 'src/app/platform/users/actions.ts#issueTempPassword@src/app/platform/users/users-list.tsx',
    kind: 'server-action',
    happy: ref('e2e/platform/management.spec.ts', 're-issues a temp password for a user who never completed first login'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
  {
    id: 'src/app/platform/actions.ts#signOutFromPlatform@src/app/platform/layout.tsx',
    kind: 'form-action',
    happy: ref('e2e/platform/zz-signout.spec.ts', 'signs out through the platform UI and revokes access to the console'),
    minimal: todo('platform-http'),
    failure: todo('platform-http'),
  },
]
// END platform-http ===========================================================================

// ============================================================================================
// BEGIN mobile (plan 5.7, branch test/e2e-mobile) — edit only inside this block
// ============================================================================================
// The mobile package exercises surfaces owned above (status, notes, reminders, Create Login…)
// under lifecycle conditions; it owns no surface of its own today. Add an entry here only for a
// surface that exists solely on the phone layout.
const MOBILE: readonly ManifestEntry[] = []
// END mobile ==================================================================================

// ============================================================================================
// BEGIN unreachable code (Phase 2 L8 deletes or wires these up)
// ============================================================================================
const UNUSED: readonly ManifestEntry[] = [
  {
    id: 'src/app/schedule/actions.ts#updateAppointment',
    kind: 'server-action',
    unused: true,
    reason: 'Edit Appointment writes through supabase:appointments.update in appointment-form.tsx instead.',
  },
  {
    id: 'src/app/billing/actions.ts#reconcilePatientBilling',
    kind: 'server-action',
    unused: true,
    reason: 'Reconciliation runs in database triggers; nothing calls the action.',
  },
  {
    id: 'src/app/billing/actions.ts#previewBillingAllocation',
    kind: 'server-action',
    unused: true,
    reason: 'The entry form previews with getOutstandingCharges.',
  },
  {
    id: 'src/app/platform/users/actions.ts#softDeleteUser',
    kind: 'server-action',
    unused: true,
    reason: 'The platform console has no delete-user control.',
  },
  {
    id: 'supabase:treatment_plans.update@src/app/patients/[id]/treatment-plan-form.tsx',
    kind: 'supabase',
    unused: true,
    reason: 'TreatmentPlanForm is only rendered for a new plan; no caller passes `plan`, so the update branch is unreachable.',
    noMatch: String.raw`<TreatmentPlanForm\b[^>]*\bplan=`,
  },
]
// END unreachable code ========================================================================

export const MUTATION_MANIFEST_BLOCKS = {
  patients: PATIENTS,
  schedule: SCHEDULE,
  billing: BILLING,
  'settings-auth': SETTINGS_AUTH,
  external: EXTERNAL,
  'platform-http': PLATFORM_HTTP,
  mobile: MOBILE,
  unused: UNUSED,
} as const

export const MUTATION_MANIFEST: readonly ManifestEntry[] = Object.values(MUTATION_MANIFEST_BLOCKS).flat()
