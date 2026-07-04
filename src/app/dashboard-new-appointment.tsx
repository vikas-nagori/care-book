'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AppointmentForm } from './schedule/appointment-form'
import type { AppointmentAssigneeOption, ExternalStaff } from '@/lib/supabase/types'

interface Props {
  patients: { id: string; name: string }[]
  assigneeOptions: AppointmentAssigneeOption[]
  externalStaffOptions: ExternalStaff[]
  currentProfileId: string | null
  canManageExternalStaff: boolean
}

export function DashboardNewAppointmentButton({
  patients,
  assigneeOptions,
  externalStaffOptions,
  currentProfileId,
  canManageExternalStaff,
}: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12.5, fontWeight: 500, padding: '7px 12px',
          borderRadius: 6, border: '1px solid var(--ph-accent)',
          background: 'var(--ph-accent)', color: '#fff', cursor: 'pointer',
        }}
      >
        <Plus size={14} />New appointment
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>New Appointment</DialogTitle></DialogHeader>
          <AppointmentForm
            patients={patients}
            assigneeOptions={assigneeOptions}
            externalStaffOptions={externalStaffOptions}
            currentProfileId={currentProfileId}
            canManageExternalStaff={canManageExternalStaff}
            defaultDate={format(new Date(), 'yyyy-MM-dd')}
            onSuccess={() => { setOpen(false); router.refresh() }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

export function DashboardNewAppointmentMobile({
  patients,
  assigneeOptions,
  externalStaffOptions,
  currentProfileId,
  canManageExternalStaff,
}: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontSize: 13, fontWeight: 500, padding: '10px 16px', minHeight: 44,
          borderRadius: 8, border: '1px solid var(--ph-accent)',
          background: 'var(--ph-accent)', color: '#fff', cursor: 'pointer',
          width: '100%',
        }}
      >
        <Plus size={15} />New appt
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>New Appointment</DialogTitle></DialogHeader>
          <AppointmentForm
            patients={patients}
            assigneeOptions={assigneeOptions}
            externalStaffOptions={externalStaffOptions}
            currentProfileId={currentProfileId}
            canManageExternalStaff={canManageExternalStaff}
            defaultDate={format(new Date(), 'yyyy-MM-dd')}
            onSuccess={() => { setOpen(false); router.refresh() }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
