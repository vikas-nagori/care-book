'use client'

import { callServerAction } from '@/lib/actions/call-server-action'
import { Fragment, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Edit, FileText, IndianRupee, Loader2, MapPin, Phone, Trash2, User, UserRound } from 'lucide-react'
import { formatDateOnly } from '@/lib/timezone'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { PaymentBadge } from '@/components/ui/status-badges'
import { formatTime12 } from '@/lib/format-time'
import type { ExternalProfileOption } from '@/lib/appointments/assignment'
import { AppointmentForm } from '../appointment-form'
import { SessionNoteForm } from './session-note-form'
import { deleteAppointment, updateAppointmentStatus } from '../actions'
import { adjustAppointmentFee } from '@/app/billing/actions'
import type { Appointment, AppointmentAssigneeOption, ExternalStaff, SessionNote } from '@/lib/supabase/types'
import { sessionNoteSections } from '@/lib/schedule/session-note-sections'

interface Props {
  appointment: Omit<Appointment, 'fee' | 'payment_status' | 'patient'> &
    Partial<Pick<Appointment, 'fee' | 'payment_status'>> & {
      external_profile?: ExternalProfileOption | null
      patient: { id: string; name: string; phone: string; address: string | null; medical_history: string | null; notes: string | null } | null
    }
  sessionNote: SessionNote | null
  patients: { id: string; name: string }[]
  assigneeOptions: AppointmentAssigneeOption[]
  externalStaffOptions: ExternalStaff[]
  currentProfileId: string | null
  canManageExternalStaff: boolean
  canViewPaymentSignals: boolean
  canManageBilling: boolean
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
  canManageBilling,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [statusPending, startStatusTransition] = useTransition()
  // Synchronous re-entrancy guard for the status Select (which stays enabled
  // mid-selection by design — see updateStatus). isPending updates async and can
  // be stale during a rapid burst, so a ref is used to block stacked submits.
  const statusInFlight = useRef(false)
  const [deletePending, setDeletePending] = useState(false)
  const [feeDialogOpen, setFeeDialogOpen] = useState(false)
  const [adjustedFee, setAdjustedFee] = useState(String(appointment.fee ?? ''))
  const [feeReason, setFeeReason] = useState('')
  const [feePending, setFeePending] = useState(false)
  const assignedProfile = appointment.assigned_to
    ? assigneeOptions.find((assignee) => assignee.id === appointment.assigned_to)
    : null
  const hasExternalAssignee = canManageExternalStaff && Boolean(appointment.external_profile_id)
  const assignedName = hasExternalAssignee
    ? appointment.external_profile?.full_name || appointment.external_profile?.email
    : appointment.external_staff?.name ?? (assignedProfile?.full_name || assignedProfile?.email)
  const assignmentRole = hasExternalAssignee ? 'External Staff' : appointment.external_staff ? 'Temporary Staff' : null
  // Only the sections that have text, with a divider between them: a note cleared of every field
  // shows no card, and the first section never sits under a divider (G-17g).
  const noteSections = sessionNoteSections(sessionNote)

  function updateStatus(status: string) {
    if (status === appointment.status) return
    if (statusInFlight.current) return
    statusInFlight.current = true
    // Route through the server action (preferred mutation path) inside a
    // transition so the refresh is non-blocking — the old direct client
    // write + synchronous disable of the Select mid-selection was locking
    // the page when changing status from the calendar.
    startStatusTransition(async () => {
      try {
        const result = await callServerAction(() => updateAppointmentStatus({ appointmentId: appointment.id, status }))
        if (result.success) {
          toast({ title: 'Status updated' })
          router.refresh()
        } else {
          toast({ title: 'Error', description: result.message, variant: 'destructive' })
        }
      } finally {
        statusInFlight.current = false
      }
    })
  }

  async function handleDelete() {
    setDeletePending(true)
    const result = await callServerAction(() => deleteAppointment(appointment.id))
    if (result.success) {
      setDeletePending(false)
      router.push('/schedule')
    } else {
      toast({ title: 'Error', description: result.message, variant: 'destructive' })
      setDeletePending(false)
    }
  }

  async function handleFeeAdjustment() {
    setFeePending(true)
    const result = await callServerAction(() => adjustAppointmentFee(appointment.id, Number(adjustedFee), feeReason))
    setFeePending(false)
    if (!result.success) {
      toast({ title: 'Fee adjustment not saved', description: result.message, variant: 'destructive' })
      return
    }
    setFeeDialogOpen(false)
    setFeeReason('')
    toast({ title: 'Fee adjustment saved', description: 'The billing ledger was reconciled.' })
    router.refresh()
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
              {/* phone is optional (nullable since migration 010) */}
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
            <p className="font-medium">{formatDateOnly(appointment.date, 'EEEE, dd MMM yyyy')}</p>
            <p className="text-sm text-muted-foreground">
              {formatTime12(appointment.time)} · {appointment.duration_minutes}min · <span>{appointment.type}</span>
            </p>
          </div>
          {canViewPaymentSignals && appointment.fee != null && (
            <div className="flex items-center gap-2 text-sm">
              <IndianRupee className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium">₹{Number(appointment.fee).toLocaleString('en-IN')}</span>
              {/* Same badge the dashboard and schedule use, so 'unpaid' reads as "Due" here too
                  rather than leaking the raw DB value. */}
              <PaymentBadge status={appointment.payment_status} />
            </div>
          )}
          {(hasExternalAssignee || (!appointment.type_is_shared && assignedName)) && (
            <div className="flex items-center gap-2 text-sm">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <span>{assignedName ?? assignmentRole}</span>
              {assignedName && assignmentRole && (
                <span className="rounded-sm border px-1.5 py-0.5 text-xs text-muted-foreground">
                  {assignmentRole}
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
              {appointment.patient.phone ? (
                <a href={`tel:${appointment.patient.phone}`} className="text-primary">{appointment.patient.phone}</a>
              ) : (
                <span className="text-sm text-muted-foreground">No phone number</span>
              )}
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
              canViewPaymentSignals={canViewPaymentSignals && appointment.status !== 'completed'}
              appointment={appointment}
              existingExternalAssignee={appointment.external_profile}
              onSuccess={() => { setEditOpen(false); router.refresh() }}
            />
          </DialogContent>
        </Dialog>
        {canManageBilling && appointment.status === 'completed' && <Dialog open={feeDialogOpen} onOpenChange={setFeeDialogOpen}>
          <DialogTrigger asChild><Button variant="outline" className="w-full md:w-auto"><IndianRupee className="h-4 w-4 mr-1" />Adjust fee</Button></DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Adjust completed appointment fee</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">This creates an immutable adjustment and reconciles regular/package balances.</p>
            <div className="space-y-2"><Label htmlFor="adjusted_fee">Adjusted fee *</Label><Input id="adjusted_fee" type="number" min="0.01" step="0.01" value={adjustedFee} onChange={(event) => setAdjustedFee(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="fee_adjustment_reason">Reason *</Label><Textarea id="fee_adjustment_reason" rows={3} value={feeReason} onChange={(event) => setFeeReason(event.target.value)} /></div>
            <Button onClick={handleFeeAdjustment} disabled={feePending || !feeReason.trim() || !Number.isFinite(Number(adjustedFee)) || Number(adjustedFee) <= 0 || Number(adjustedFee) === Number(appointment.fee)}>
              {feePending ? <><Loader2 className="animate-spin" size={14} /> Saving…</> : 'Save fee adjustment'}
            </Button>
          </DialogContent>
        </Dialog>}

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
                <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => { event.preventDefault(); handleDelete() }}
                  disabled={deletePending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deletePending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Deleting…</> : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {noteSections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Session Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {noteSections.map((section, index) => (
              <Fragment key={section.label}>
                {index > 0 && <Separator />}
                <div>
                  <p className="text-sm font-medium text-primary">{section.label}</p>
                  <p className="text-sm whitespace-pre-wrap">{section.text}</p>
                </div>
              </Fragment>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}
