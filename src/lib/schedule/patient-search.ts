export type AppointmentPatientOption = {
  id: string
  name: string
}

export type AppointmentPatientDraft = {
  name: string
  phone: string
  email: string
  dob: string
  gender: string
  address: string
  medical_history: string
  notes: string
}

type PatientInsertData = {
  name: string
  phone: string
  email: string | null
  dob: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
}

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase()
}

function normalizeOptionalField(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function filterAppointmentPatientOptions(
  patients: AppointmentPatientOption[],
  query: string,
) {
  const normalizedQuery = normalizeSearchValue(query)

  if (!normalizedQuery) {
    return patients
  }

  return patients.filter((patient) =>
    normalizeSearchValue(patient.name).includes(normalizedQuery),
  )
}

export function shouldOfferCreatePatientOption(
  patients: AppointmentPatientOption[],
  query: string,
) {
  const normalizedQuery = normalizeSearchValue(query)

  if (!normalizedQuery) {
    return false
  }

  return !patients.some(
    (patient) => normalizeSearchValue(patient.name) === normalizedQuery,
  )
}

export function createPatientDraftFromName(name: string): AppointmentPatientDraft {
  return {
    name: name.trim(),
    phone: '',
    email: '',
    dob: '',
    gender: '',
    address: '',
    medical_history: '',
    notes: '',
  }
}

export function buildPatientInsertData(
  draft: AppointmentPatientDraft,
): PatientInsertData {
  return {
    name: draft.name.trim(),
    phone: draft.phone.trim(),
    email: normalizeOptionalField(draft.email),
    dob: normalizeOptionalField(draft.dob),
    gender: normalizeOptionalField(draft.gender),
    address: normalizeOptionalField(draft.address),
    medical_history: normalizeOptionalField(draft.medical_history),
    notes: normalizeOptionalField(draft.notes),
  }
}
