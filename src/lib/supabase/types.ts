export type ReferralSource = 'walk_in' | 'doctor' | 'other'

export type Doctor = {
  id: string
  name: string
  specialty: string | null
  address: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type Patient = {
  id: string
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
  patient_id: string
  date: string
  time: string
  duration_minutes: number
  type: 'home_visit' | 'clinic' | 'clinic_home_visit'
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
  patient_id: string
  name: string
  total_sessions: number
  used_sessions: number
  total_amount: number
  per_session_amount: number
  paid_amount: number
  payment_timing: 'prepaid' | 'postpaid'
  status: 'active' | 'completed' | 'cancelled'
  created_at: string
}

export type Payment = {
  id: string
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
  home_visit_fee: number
  clinic_fee: number
  clinic_home_visit_fee: number
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

export type Profile = {
  id: string
  email: string
  role: UserRole
  full_name: string | null
  mobile_number: string | null
  created_at: string
  updated_at: string
}

export type AppointmentAssigneeOption = Pick<Profile, 'id' | 'email' | 'role' | 'full_name'>

export type ExternalStaffStatus = 'active' | 'onboarded' | 'inactive'

export type ExternalStaff = {
  id: string
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
  clinicHomeVisitFee: number
}

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
  packagePaymentTiming?: 'prepaid' | 'postpaid'
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
