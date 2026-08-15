'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DashboardAppointmentOptions } from '@/lib/dashboard/appointment-options'
import { getDashboardAppointmentOptions } from './dashboard-actions'
import { AppointmentForm } from './schedule/appointment-form'

interface Props {
  defaultDate: string
}

type OptionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: DashboardAppointmentOptions }
  | { status: 'error'; message: string; retryable: boolean }

function DashboardNewAppointment({
  defaultDate,
  mobile,
}: Props & { mobile: boolean }) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<OptionState>({ status: 'idle' })
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)
  const requestInFlightRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
    }
  }, [])

  function loadOptions() {
    if (requestInFlightRef.current || options.status === 'success') return

    requestInFlightRef.current = true
    const requestId = ++requestIdRef.current
    setOptions({ status: 'loading' })

    getDashboardAppointmentOptions()
      .then((result) => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return
        requestInFlightRef.current = false
        if (result.ok) {
          setOptions({ status: 'success', data: result.data })
          return
        }
        setOptions({
          status: 'error',
          message: result.message,
          retryable: result.retryable,
        })
      })
      .catch(() => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return
        requestInFlightRef.current = false
        setOptions({
          status: 'error',
          message: 'Unable to load appointment options.',
          retryable: true,
        })
      })
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen && options.status === 'idle') loadOptions()
  }

  const triggerStyle = mobile
    ? {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontSize: 13,
        fontWeight: 500,
        padding: '10px 16px',
        minHeight: 44,
        borderRadius: 8,
        border: '1px solid var(--ph-accent)',
        background: 'var(--ph-accent)',
        color: '#fff',
        cursor: 'pointer',
        width: '100%',
      }
    : {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12.5,
        fontWeight: 500,
        padding: '7px 12px',
        borderRadius: 6,
        border: '1px solid var(--ph-accent)',
        background: 'var(--ph-accent)',
        color: '#fff',
        cursor: 'pointer',
      }

  return (
    <>
      <button type="button" onClick={() => handleOpenChange(true)} style={triggerStyle}>
        <Plus size={mobile ? 15 : 14} />{mobile ? 'New appt' : 'New appointment'}
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Appointment</DialogTitle>
            <DialogDescription className="sr-only">
              Create an appointment after the available form options load.
            </DialogDescription>
          </DialogHeader>
          {options.status === 'loading' && (
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading appointment options…
            </div>
          )}
          {options.status === 'error' && (
            <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">{options.message}</p>
              {options.retryable && (
                <button
                  type="button"
                  onClick={loadOptions}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {options.status === 'success' && (
            <AppointmentForm
              patients={options.data.patients}
              doctors={options.data.doctors}
              assigneeOptions={options.data.assigneeOptions}
              externalStaffOptions={options.data.externalStaffOptions}
              initialAppointmentTypes={options.data.appointmentTypes}
              currentProfileId={options.data.currentProfileId}
              canManageExternalStaff={options.data.canManageExternalStaff}
              canViewPaymentSignals={options.data.canViewPaymentSignals}
              defaultDate={defaultDate}
              onSuccess={() => {
                setOpen(false)
                router.refresh()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function DashboardNewAppointmentButton(props: Props) {
  return <DashboardNewAppointment {...props} mobile={false} />
}

export function DashboardNewAppointmentMobile(props: Props) {
  return <DashboardNewAppointment {...props} mobile />
}
