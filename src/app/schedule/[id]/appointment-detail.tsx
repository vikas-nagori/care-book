'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Edit, FileText, IndianRupee, Loader2, MapPin, Phone, Trash2, User, UserRound } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { formatTime12 } from '@/lib/format-time'
import { AppointmentForm } from '../appointment-form'
import { SessionNoteForm } from './session-note-form'
import { deleteAppointment, updateAppointmentStatus } from '../actions'
import type { Appointment, AppointmentAssigneeOption, ExternalStaff, SessionNote } from '@/lib/supabase/types'
import { APPOINTMENT_TYPE_LABEL, isHomeVisitType } from '@/lib/appointments/appointment-type'

interface Props {
  appointment: Appointment & { patient: { id: string; name: string; phone: string; address: string | null; medical_history: string | null; notes: string | null } | null }
  sessionNote: SessionNote | null
  patients: { id: string; name: string }[]
  assigneeOptions: AppointmentAssigneeOption[]
  externalStaffOptions: ExternalStaff[]
  currentProfileId: string | null
  canManageExternalStaff: boolean
  canViewPaymentSignals: boolean
}

export function AppointmentDetail({
  appointment,
  sessionNote,
  patients,
  assigneeOptions,
  externalStaffOptions,
  currentProfileId,
  canManageExternalStaff,
  canViewPaymentSignals,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [statusPending, startStatusTransition] = useTransition()
  const [deletePending, setDeletePending] = useState(false)
  const assignedProfile = appointment.assigned_to
    ? assigneeOptions.find((assignee) => assignee.id === appointment.assigned_to)
    : null
  const assignedName = appointment.external_staff?.name
    ?? (assignedProfile ? (assignedProfile.full_name || assignedProfile.email) : null)

  function updateStatus(status: string) {
    if (status === appointment.status) return
    // Route through the server action (preferred mutation path) inside a
    // transition so the refresh is non-blocking — the old direct client
    // write + synchronous disable of the Select mid-selection was locking
    // the page when changing status from the calendar.
    startStatusTransition(async () => {
      const result = await updateAppointmentStatus({ appointmentId: appointment.id, status })
      if (result.success) {
        toast({ title: 'Status updated' })
        router.refresh()
      } else {
        toast({ title: 'Error', description: result.message, variant: 'destructive' })
      }
    })
  }

  async function handleDelete() {
    setDeletePending(true)
    const result = await deleteAppointment(appointment.id)
    if (result.success) {
      setDeletePending(false)
      router.push('/schedule')
    } else {
      toast({ title: 'Error', description: result.message, variant: 'destructive' })
      setDeletePending(false)
    }
  }

  return (
    <>
      <MobilePageHeader title="Appointment" onBack={() => router.back()} />
      <div className="hidden md:flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold flex-1">Appointment</h1>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-6 space-y-3">
          {appointment.patient && (
            <div className="flex items-center gap-2">
              <Link href={`/patients/${appointment.patient.id}`} className="flex items-center gap-2 text-primary flex-1">
                <User className="h-4 w-4" />
                {appointment.patient.name}
              </Link>
              {/* phone is NOT NULL in DB; guard catches empty string from legacy records */}
              {appointment.patient.phone && (
                <a
                  href={`tel:${appointment.patient.phone}`}
                  className="flex items-center justify-center min-w-[44px] min-h-[44px]"
                  style={{
                    borderRadius: 8, border: '1px solid var(--ph-ok)',
                    background: 'var(--ph-ok-soft)', color: 'var(--ph-ok)',
                  }}
                  aria-label={`Call ${appointment.patient.name}`}
                >
                  <Phone size={16} />
                </a>
              )}
            </div>
          )}
          <div>
            <p className="font-medium">{format(new Date(appointment.date), 'EEEE, dd MMM yyyy')}</p>
            <p className="text-sm text-muted-foreground">
              {formatTime12(appointment.time)} · {appointment.duration_minutes}min · <span>{APPOINTMENT_TYPE_LABEL[appointment.type]}</span>
            </p>
          </div>
          {canViewPaymentSignals && appointment.fee != null && (
            <div className="flex items-center gap-2 text-sm">
              <IndianRupee className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium">₹{Number(appointment.fee).toLocaleString('en-IN')}</span>
              <span className="text-muted-foreground capitalize">· {appointment.payment_status}</span>
            </div>
          )}
          {isHomeVisitType(appointment.type) && assignedName && (
            <div className="flex items-center gap-2 text-sm">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <span>{assignedName}</span>
              {appointment.external_staff && (
                <span className="rounded-sm border px-1.5 py-0.5 text-xs text-muted-foreground">
                  External
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm">Status:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Select value={appointment.status} onValueChange={updateStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              {statusPending && <Loader2 className="animate-spin" size={14} style={{ color: 'var(--ph-accent)', flexShrink: 0 }} />}
            </div>
          </div>
          {appointment.notes && (
            <p className="text-sm text-muted-foreground">{appointment.notes}</p>
          )}
        </CardContent>
      </Card>

      {appointment.patient && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Patient Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <a href={`tel:${appointment.patient.phone}`} className="text-primary">{appointment.patient.phone}</a>
            </div>
            {appointment.patient.address && (
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <span className="text-sm">{appointment.patient.address}</span>
              </div>
            )}
            {appointment.patient.medical_history && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-1">Medical History</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{appointment.patient.medical_history}</p>
                </div>
              </>
            )}
            {appointment.patient.notes && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-1">Notes</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{appointment.patient.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2 mb-4 md:flex-row">
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full md:w-auto">
              <Edit className="h-4 w-4 mr-1" />
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Appointment</DialogTitle>
            </DialogHeader>
            <AppointmentForm
              patients={patients}
              assigneeOptions={assigneeOptions}
              externalStaffOptions={externalStaffOptions}
              currentProfileId={currentProfileId}
              canManageExternalStaff={canManageExternalStaff}
              appointment={appointment}
              onSuccess={() => { setEditOpen(false); router.refresh() }}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
          <DialogTrigger asChild>
            <Button className="w-full md:w-auto">
              <FileText className="h-4 w-4 mr-1" />
              {sessionNote ? 'Edit Notes' : 'Add Notes'}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Session Notes (SOAP)</DialogTitle>
            </DialogHeader>
            <SessionNoteForm
              appointmentId={appointment.id}
              sessionNote={sessionNote}
              onSuccess={() => { setNoteOpen(false); router.refresh() }}
            />
          </DialogContent>
        </Dialog>

        {appointment.status === 'scheduled' && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full md:w-auto text-destructive hover:text-destructive"
                disabled={deletePending}
              >
                {deletePending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                {deletePending ? 'Deleting…' : 'Delete'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete appointment?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove the appointment. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {sessionNote && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Session Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessionNote.subjective && (
              <div>
                <p className="text-sm font-medium text-primary">Subjective</p>
                <p className="text-sm whitespace-pre-wrap">{sessionNote.subjective}</p>
              </div>
            )}
            {sessionNote.objective && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-primary">Objective</p>
                  <p className="text-sm whitespace-pre-wrap">{sessionNote.objective}</p>
                </div>
              </>
            )}
            {sessionNote.assessment && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-primary">Assessment</p>
                  <p className="text-sm whitespace-pre-wrap">{sessionNote.assessment}</p>
                </div>
              </>
            )}
            {sessionNote.plan && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-primary">Plan</p>
                  <p className="text-sm whitespace-pre-wrap">{sessionNote.plan}</p>
                </div>
              </>
            )}
            {sessionNote.exercises_prescribed && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-primary">Exercises Prescribed</p>
                  <p className="text-sm whitespace-pre-wrap">{sessionNote.exercises_prescribed}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
