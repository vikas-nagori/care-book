export type ReferralSource = 'walk_in' | 'doctor' | 'other'

export type ClinicStatus = 'active' | 'inactive'

export type Clinic = {
  id: string
  name: string
  phone: string | null
  address: string | null
  status: ClinicStatus
  created_at: string
  updated_at: string
}

export type ClinicOnboardingRequestStatus = 'pending' | 'approved' | 'rejected'

export type ClinicOnboardingRequest = {
  id: string
  clinic_name: string
  owner_full_name: string
  owner_email: string
  owner_mobile_number: string
  clinic_phone: string | null
  clinic_address: string | null
  status: ClinicOnboardingRequestStatus
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  clinic_id: string | null
  request_ip: string | null
  request_user_agent: string | null
  request_fingerprint: string | null
  created_at: string
  updated_at: string
}

export type Doctor = {
  id: string
  clinic_id: string
  name: string
  specialty: string | null
  address: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type Patient = {
  id: string
  clinic_id: string
  name: string
  phone: string
  email: string | null
  dob: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
  referral_source: ReferralSource | null
  referred_by_doctor_id: string | null
  created_at: string
  updated_at: string
  referred_by_doctor?: Doctor | null
}

export type Appointment = {
  id: string
  clinic_id: string
  patient_id: string
  date: string
  time: string
  duration_minutes: number
  // Denormalized human label of the appointment's type (source of truth is
  // appointment_type_id). type_is_shared mirrors the type's visibility flag.
  type: string
  appointment_type_id: string
  type_is_shared: boolean
  status: 'scheduled' | 'completed' | 'cancelled'
  payment_status: 'unpaid' | 'prepaid' | 'paid'
  fee: number | null
  notes: string | null
  created_by: string | null
  assigned_to: string | null
  external_staff_id: string | null
  created_at: string
  patient?: Patient
  creator?: Profile | null
  assignee?: Profile | null
  external_staff?: ExternalStaff | null
}

export type TreatmentPlan = {
  id: string
  clinic_id: string
  patient_id: string
  diagnosis: string
  goals: string | null
  start_date: string
  expected_end_date: string | null
  status: 'active' | 'completed' | 'discontinued'
  created_at: string
}

export type SessionNote = {
  id: string
  appointment_id: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  exercises_prescribed: string | null
  created_at: string
  appointment?: Appointment
}

export type Package = {
  id: string
  clinic_id: string
  patient_id: string
  name: string
  total_sessions: number
  used_sessions: number
  total_amount: number
  per_session_amount: number
  paid_amount: number
  payment_timing: 'prepaid'
  status: 'active' | 'completed' | 'cancelled'
  created_at: string
}

export type Payment = {
  id: string
  clinic_id: string
  patient_id: string
  package_id: string | null
  appointment_id: string | null
  amount: number
  payment_method: string
  date: string
  notes: string | null
  created_at: string
}

export type GlobalSettings = {
  id: number
  clinic_id: string
  home_visit_fee: number
  clinic_fee: number
}

export type AppointmentType = {
  id: string
  clinic_id: string
  name: string
  session_rate: number
  is_shared: boolean
  is_default: boolean
  sort_order: number
  created_at: string
}

export type AppointmentPayment = {
  id: string
  payment_id: string
  appointment_id: string
  amount_applied: number
  created_at: string
}

export type PackageSessionAllocation = {
  id: string
  package_id: string
  appointment_id: string
  created_at: string
}

export type UserRole = 'admin' | 'staff'

export type ProfileStatus = 'active' | 'blocked'

export type Profile = {
  id: string
  clinic_id: string | null
  email: string
  role: UserRole
  full_name: string | null
  mobile_number: string | null
  status: ProfileStatus
  created_at: string
  updated_at: string
}

export type AppointmentAssigneeOption = Pick<Profile, 'id' | 'email' | 'role' | 'full_name'>

export type ExternalStaffStatus = 'active' | 'onboarded' | 'inactive'

export type ExternalStaff = {
  id: string
  clinic_id: string
  name: string
  phone: string
  email: string | null
  notes: string | null
  status: ExternalStaffStatus
  linked_profile_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  linked_profile?: Profile | null
}

export type UserInviteStatus = 'pending' | 'accepted' | 'revoked'

export type UserInvite = {
  id: string
  clinic_id: string
  email: string
  role: UserRole
  status: UserInviteStatus
  auth_user_id: string | null
  external_staff_id: string | null
  invited_by: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

export type UpdateGlobalSettingsInput = {
  clinicFee: number
  homeVisitFee: number
}

export type CreateAppointmentTypeInput = {
  name: string
  sessionRate: number
  isShared: boolean
}

export type UpdateAppointmentTypeInput = CreateAppointmentTypeInput & {
  id: string
}

export type AppointmentTypeResult =
  | {
      success: true
      appointmentType: AppointmentType
    }
  | ActionErrorResult

export type DeleteAppointmentTypeResult =
  | {
      success: true
      id: string
    }
  | ActionErrorResult

export type ActionErrorResult = {
  success: false
  errorCode: string
  message: string
}

export type UpdateGlobalSettingsResult =
  | {
      success: true
      settings: GlobalSettings
    }
  | ActionErrorResult

export type RecordPaymentInput = {
  patientId: string
  packageId: string | null
  amount: number
  paymentMethod: string
  date: string
  notes: string | null
}

export type RecordPaymentSuccessResult = {
  success: true
  paymentId: string
  linkedAppointmentIds: string[]
  updatedPackageId: string | null
}

export type RecordPaymentResult = RecordPaymentSuccessResult | ActionErrorResult

export type BillingEntryKind = 'payment_only' | 'package_with_payment'
export type BillingMode = BillingEntryKind

export type CreateBillingEntryInput = {
  patientId: string
  mode: BillingEntryKind
  packageName?: string
  packageTotalSessions?: number
  packagePerSessionAmount?: number
  paymentAmount?: number
  paymentMethod?: string
  paymentDate?: string
  paymentNotes?: string | null
}

export type CreateBillingEntrySuccessResult = {
  success: true
  packageId: string | null
  paymentId: string | null
  linkedAppointmentIds: string[]
  remainingCredit: number
}

export type CreateBillingEntryErrorResult = ActionErrorResult & {
  packageId?: string | null
  packageName?: string | null
}

export type CreateBillingEntryResult =
  | CreateBillingEntrySuccessResult
  | CreateBillingEntryErrorResult

export type CreateUserInviteInput = {
  email: string
  role: UserRole
  externalStaffId?: string | null
}

export type CreateClinicOnboardingRequestInput = {
  clinicName: string
  ownerFullName: string
  ownerEmail: string
  ownerMobileNumber: string
  clinicPhone?: string | null
  clinicAddress?: string | null
}

export type CreateClinicOnboardingRequestResult =
  | {
      success: true
      requestId: string
    }
  | ActionErrorResult

export type ManageClinicOnboardingRequestInput = {
  requestId: string
  rejectionReason?: string | null
}

export type ManageClinicOnboardingRequestResult =
  | {
      success: true
      request: ClinicOnboardingRequest
    }
  | ActionErrorResult

export type CreateExternalStaffInput = {
  name: string
  phone: string
  email?: string | null
  notes?: string | null
}

export type CreateExternalStaffResult =
  | {
      success: true
      externalStaff: ExternalStaff
    }
  | ActionErrorResult

export type CreateUserInviteResult =
  | {
      success: true
      invite: UserInvite
    }
  | ActionErrorResult

export type ManageUserInviteInput = {
  inviteId: string
}

export type ManageUserInviteResult =
  | {
      success: true
      invite: UserInvite
    }
  | ActionErrorResult

export type CompleteInvitedSignupInput = {
  fullName: string
  mobileNumber: string
  password: string
  passwordConfirmation: string
}

export type CompleteInvitedSignupResult =
  | {
      success: true
    }
  | ActionErrorResult

export type ManageClinicBlockInput = {
  clinicId: string
}

export type ManageClinicBlockResult =
  | {
      success: true
      status: ClinicStatus
    }
  | ActionErrorResult

export type ManageUserBlockInput = {
  userId: string
}

export type ManageUserBlockResult =
  | {
      success: true
      status: ProfileStatus
    }
  | ActionErrorResult

// Clinic row with aggregated counts, for the superadmin console.
export type PlatformClinicSummary = Clinic & {
  user_count: number
  patient_count: number
}

// Profile row joined with its clinic, for the superadmin users directory.
export type PlatformUserSummary = Profile & {
  clinic_name: string | null
  clinic_status: ClinicStatus | null
}
