'use client'

import { useRouter } from 'next/navigation'
import { AppointmentForm } from '../appointment-form'
import type { AppointmentAssigneeOption, Appointment, ExternalStaff } from '@/lib/supabase/types'
import type { AppointmentPatientOption } from '@/lib/schedule/patient-search'

interface Props {
  patients: AppointmentPatientOption[]
  assigneeOptions: AppointmentAssigneeOption[]
  externalStaffOptions: ExternalStaff[]
  currentProfileId: string | null
  canManageExternalStaff: boolean
  defaultDate: string
  defaultPatientId?: string
  appointment?: Appointment
  from?: string
}

export function NewAppointmentForm({ from, ...formProps }: Props) {
  const router = useRouter()

  return (
    <AppointmentForm
      {...formProps}
      onSuccess={() => {
        router.push(from || '/schedule')
        router.refresh()
      }}
    />
  )
}
