'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { PatientListHeader, PatientRows, PatientSearchBar } from '@/components/patients/patient-rows'
import { normalizePatientSearchTerm } from '@/lib/patients/patient-search-filter'
import type { ExternalPatient, ExternalWorkspace } from '@/lib/external/types'
import { EXTERNAL_ACCESS_MESSAGE } from '@/lib/external/workspace'
import { formatAge, patientAge } from '@/lib/patients/age'
import { ExternalBookingDialog } from './booking-dialog'
import { useRequestIds } from './use-request-ids'

function PatientDetails({ patient }: { patient: ExternalPatient }) {
  const age = patientAge(patient)
  const details = [
    { label: 'Phone', value: patient.phone, href: patient.phone ? `tel:${patient.phone}` : null },
    { label: 'Email', value: patient.email, href: patient.email ? `mailto:${patient.email}` : null },
    { label: 'Age', value: age === null ? null : formatAge(age) },
    { label: 'Gender', value: patient.gender },
    { label: 'Address', value: patient.address },
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
      {details.map(({ label, value, href }) => (
        <div key={label} className={label === 'Address' ? 'col-span-2' : 'min-w-0'}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words">
            {href ? <a href={href} className="text-primary underline-offset-2 hover:underline">{value}</a> : value ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Same matching as the clinic search (name or phone), over the patients shared with this account. */
export function matchesPatientSearch(patient: ExternalPatient, search: string) {
  const term = normalizePatientSearchTerm(search).toLowerCase()
  if (!term) return true
  return patient.name.toLowerCase().includes(term) || Boolean(patient.phone?.toLowerCase().includes(term))
}

export function ExternalPatients({ workspace, todayDate, timeZone }: { workspace: ExternalWorkspace; todayDate: string; timeZone: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const requestIds = useRequestIds()
  const [search, setSearch] = useState('')
  const [opened, setOpened] = useState<ExternalPatient | null>(null)
  const [booking, setBooking] = useState<{ patientId: string; trigger: HTMLButtonElement } | null>(null)
  const [denied, setDenied] = useState<ExternalWorkspace | null>(null)
  const canBook = workspace.appointment_types.length > 0 && denied !== workspace
  const term = normalizePatientSearchTerm(search)
  const filtered = workspace.patients.filter((patient) => matchesPatientSearch(patient, search))

  if (denied === workspace) {
    return <div role="status" className="rounded-lg border bg-card p-5 text-sm">{EXTERNAL_ACCESS_MESSAGE}</div>
  }

  return (
    <>
      <PatientListHeader
        title="Patients"
        subtitle={term
          ? `${filtered.length} of ${workspace.patients.length} match “${term}”`
          : `${workspace.patients.length} shared with you`}
      />

      {workspace.patients.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card px-5 py-11 text-center">
          <UserRound className="mx-auto mb-3 size-6 text-primary" aria-hidden="true" />
          <p className="font-semibold">No patients have been shared</p>
          <p className="mt-1 text-sm text-muted-foreground">Ask your clinic admin to share the patients you work with.</p>
        </div>
      ) : (
        <>
          <PatientSearchBar value={search} onChange={setSearch} />
          <PatientRows
            patients={filtered}
            emptyMessage={`No patients match “${term}”.`}
            actionFor={(patient) => ({ onSelect: () => setOpened(patient) })}
            detailColumn={{ label: 'Email', render: (patient) => patient.email ?? '—' }}
          />
        </>
      )}

      {opened && (
        <Dialog open onOpenChange={(open) => { if (!open) setOpened(null) }}>
          <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg">
            <DialogHeader><DialogTitle>{opened.name}</DialogTitle></DialogHeader>
            <PatientDetails patient={opened} />
            <Button
              type="button"
              className="min-h-11 w-full sm:w-fit"
              disabled={!canBook}
              onClick={(event) => {
                setBooking({ patientId: opened.id, trigger: event.currentTarget })
                setOpened(null)
              }}
            >
              <Plus aria-hidden="true" className="size-4" /> Book appointment
            </Button>
            {!canBook && <p className="text-sm text-muted-foreground">Ask your clinic admin to set up an appointment type.</p>}
          </DialogContent>
        </Dialog>
      )}

      {booking && canBook && (
        <ExternalBookingDialog
          defaultPatientId={booking.patientId}
          defaultDate={todayDate}
          minDate={todayDate}
          onBooked={(date) => {
            setBooking(null)
            toast({ title: 'Appointment booked' })
            router.push(`/external?date=${date}`)
          }}
          onClose={() => setBooking(null)}
          onDenied={() => { setBooking(null); setDenied(workspace); router.refresh() }}
          patients={workspace.patients}
          types={workspace.appointment_types}
          timeZone={timeZone}
          getRequestId={requestIds.getRequestId}
          clearRequestId={requestIds.clearRequestId}
          returnFocus={booking.trigger}
        />
      )}
    </>
  )
}
