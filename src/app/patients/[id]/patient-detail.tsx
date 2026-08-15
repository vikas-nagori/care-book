'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Edit, Phone, Mail, MapPin, Calendar, Plus, Stethoscope, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { formatTime12 } from '@/lib/format-time'
import { formatDateOnly } from '@/lib/timezone'
import { getPaginationItems } from '@/lib/patients/appointment-pagination'
import { getFundingScopeLabel } from '@/lib/billing/unified-billing'
import { TreatmentPlanForm } from './treatment-plan-form'
import { deletePatient } from '../actions'
import type { Patient, Appointment, TreatmentPlan, Package, Payment, ReferralSource, PackageBillingBalanceV2, PatientBillingBalanceV2 } from '@/lib/supabase/types'

const REFERRAL_SOURCE_LABEL: Record<ReferralSource, string> = {
  walk_in: 'Walk-in',
  doctor: 'Referred by doctor',
  other: 'Other',
}

type AppointmentSummary = Pick<Appointment, 'id' | 'date' | 'time' | 'duration_minutes' | 'type' | 'status'>

interface PatientDetailProps {
  defaultDate: string
  canViewBilling: boolean
  isAdmin: boolean
  patient: Patient
  appointments: AppointmentSummary[]
  appointmentsTotalCount: number
  appointmentsActiveCount: number
  appointmentPage: number
  appointmentPageSize: number
  initialTab: 'profile' | 'appointments'
  treatmentPlans: TreatmentPlan[]
  packages: Package[]
  payments: Payment[]
  patientBalance: PatientBillingBalanceV2 | null
  packageBalances: Record<string, PackageBillingBalanceV2>
}

const statusColors: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  discontinued: 'bg-red-100 text-red-800',
}

const PAYMENT_LIST_INITIAL = 20

export function PatientDetail({
  defaultDate,
  canViewBilling,
  isAdmin,
  patient,
  appointments,
  appointmentsTotalCount,
  appointmentsActiveCount,
  appointmentPage,
  appointmentPageSize,
  initialTab,
  treatmentPlans,
  packages,
  payments,
  patientBalance,
  packageBalances,
}: PatientDetailProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [planOpen, setPlanOpen] = useState(false)
  const [showAllPayments, setShowAllPayments] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const canConfirmDelete = confirmText.trim() === patient.name.trim()

  const confirmDeletePatient = async () => {
    if (!canConfirmDelete) return
    setDeleting(true)
    const result = await deletePatient(patient.id)
    if (!result.success) {
      setDeleting(false)
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: result.message ?? 'Could not delete patient. Please try again.',
      })
      return
    }
    toast({
      title: 'Patient deleted',
      description: `${patient.name} and all associated records were removed.`,
    })
    router.push('/patients')
  }

  const deleteButton = isAdmin ? (
    <Button
      size="sm"
      variant="outline"
      className="min-h-[44px] text-red-600 hover:text-red-700"
      onClick={() => setDeleteOpen(true)}
    >
      <Trash2 className="h-4 w-4 mr-1" />
      Delete
    </Button>
  ) : null

  const totalBilled = Number(patientBalance?.quote_amount ?? 0)
  const totalPaid = Number(patientBalance?.net_received ?? 0)
  const outstanding = Number(patientBalance?.due_amount ?? 0)
  const refundableCredit = Number(patientBalance?.refundable_credit ?? 0)
  const visiblePayments = showAllPayments ? payments : payments.slice(0, PAYMENT_LIST_INITIAL)
  const appointmentTotalPages = Math.max(1, Math.ceil(appointmentsTotalCount / appointmentPageSize))
  const appointmentPaginationItems = getPaginationItems(appointmentPage, appointmentTotalPages)
  const appointmentPageHref = (page: number) =>
    `/patients/${patient.id}?tab=appointments&appointments_page=${page}`

  return (
    <>
      <MobilePageHeader
        title={patient.name}
        onBack={() => router.back()}
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/patients/${patient.id}/edit`}>
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </Link>
            </Button>
            {deleteButton}
          </div>
        }
      />
      <div className="hidden md:flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold flex-1">{patient.name}</h1>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/patients/${patient.id}/edit`}>
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Link>
        </Button>
        {deleteButton}
      </div>

      <Tabs defaultValue={initialTab} className="space-y-4">
        <div className="overflow-x-auto">
        <TabsList className={`w-full grid min-w-max ${canViewBilling ? 'grid-cols-4' : 'grid-cols-3'}`}>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="appointments">Appts</TabsTrigger>
          <TabsTrigger value="treatment">Plans</TabsTrigger>
          {canViewBilling && <TabsTrigger value="billing">Billing</TabsTrigger>}
        </TabsList>
        </div>

        <TabsContent value="profile">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a href={`tel:${patient.phone}`} className="text-primary flex-1 pointer-events-none md:pointer-events-auto">{patient.phone}</a>
                <a
                  href={`tel:${patient.phone}`}
                  className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px]"
                  style={{
                    borderRadius: '8px', border: '1px solid var(--ph-ok)',
                    background: 'var(--ph-ok-soft)', color: 'var(--ph-ok)',
                  }}
                  aria-label={`Call ${patient.name}`}
                >
                  <Phone size={16} />
                </a>
              </div>
              {patient.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${patient.email}`} className="text-primary">{patient.email}</a>
                </div>
              )}
              {patient.address && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{patient.address}</span>
                </div>
              )}
              {patient.dob && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{formatDateOnly(patient.dob, 'dd MMM yyyy')}</span>
                  {patient.gender && <Badge variant="secondary" className="capitalize">{patient.gender}</Badge>}
                </div>
              )}
              {patient.referral_source && (
                <>
                  <Separator />
                  <div className="flex items-start gap-2">
                    <Stethoscope className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="text-sm">
                      <span className="font-medium">Referral: </span>
                      <span>{REFERRAL_SOURCE_LABEL[patient.referral_source]}</span>
                      {patient.referral_source === 'doctor' && patient.referred_by_doctor && (
                        <div className="text-muted-foreground">
                          {patient.referred_by_doctor.name}
                          {patient.referred_by_doctor.specialty && ` · ${patient.referred_by_doctor.specialty}`}
                          {patient.referred_by_doctor.address && (
                            <div>{patient.referred_by_doctor.address}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
              {patient.medical_history && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-1">Medical History</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{patient.medical_history}</p>
                  </div>
                </>
              )}
              {patient.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-1">Notes</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{patient.notes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appointments">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 mb-2">
              <Button size="sm" asChild>
                <Link href={`/schedule/new?patient_id=${patient.id}&from=/patients/${patient.id}`}>
                  <Calendar className="h-4 w-4 mr-1" />
                  Book Appointment
                </Link>
              </Button>
              {appointmentsActiveCount > 0 && (
                <p className="text-sm font-medium text-muted-foreground" data-testid="appointment-count">
                  {appointmentsActiveCount} appointment{appointmentsActiveCount === 1 ? '' : 's'}
                </p>
              )}
            </div>
            {appointments.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No appointments yet.</p>
            ) : (
              <>
                {appointments.map((appt) => (
                  <Card key={appt.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{formatDateOnly(appt.date, 'dd MMM yyyy')} at {formatTime12(appt.time)}</p>
                          <p className="text-sm text-muted-foreground">{appt.type} · {appt.duration_minutes}min</p>
                        </div>
                        <Badge className={statusColors[appt.status] || ''}>
                          {appt.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {appointmentTotalPages > 1 && (
                  <nav
                    aria-label="Appointment history pages"
                    className="flex flex-wrap items-center justify-center gap-1 pt-3"
                  >
                    {appointmentPage > 1 ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={appointmentPageHref(appointmentPage - 1)}>Previous</Link>
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled>Previous</Button>
                    )}

                    {appointmentPaginationItems.map((item, index) =>
                      item === 'ellipsis' ? (
                        <span key={`ellipsis-${index}`} className="px-2 text-sm text-muted-foreground">…</span>
                      ) : (
                        <Button
                          key={item}
                          variant={item === appointmentPage ? 'default' : 'outline'}
                          size="sm"
                          className="min-w-10"
                          asChild
                        >
                          <Link
                            href={appointmentPageHref(item)}
                            aria-current={item === appointmentPage ? 'page' : undefined}
                          >
                            {item}
                          </Link>
                        </Button>
                      ),
                    )}

                    {appointmentPage < appointmentTotalPages ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={appointmentPageHref(appointmentPage + 1)}>Next</Link>
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled>Next</Button>
                    )}
                  </nav>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="treatment">
          <div className="space-y-2">
            <Dialog open={planOpen} onOpenChange={setPlanOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="mb-2">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Plan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>New Treatment Plan</DialogTitle>
                </DialogHeader>
                <TreatmentPlanForm
                  patientId={patient.id}
                  defaultDate={defaultDate}
                  onSuccess={() => { setPlanOpen(false); router.refresh() }}
                />
              </DialogContent>
            </Dialog>
            {treatmentPlans.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No treatment plans yet.</p>
            ) : (
              treatmentPlans.map((plan) => (
                <Card key={plan.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium">{plan.diagnosis}</p>
                      <Badge className={statusColors[plan.status] || ''}>{plan.status}</Badge>
                    </div>
                    {plan.goals && <p className="text-sm text-muted-foreground">{plan.goals}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      Started {formatDateOnly(plan.start_date, 'dd MMM yyyy')}
                      {plan.expected_end_date && ` · Target: ${formatDateOnly(plan.expected_end_date, 'dd MMM yyyy')}`}
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {canViewBilling && (
          <TabsContent value="billing">
            <div className="grid grid-cols-2 gap-2 mb-4 md:grid-cols-4">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Billed</p>
                  <p className="text-lg font-bold">₹{totalBilled.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Net received</p>
                  <p className="text-lg font-bold text-green-600">₹{totalPaid.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Due</p>
                  <p className="text-lg font-bold text-red-600">₹{outstanding.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Refundable credit</p>
                  <p className="text-lg font-bold text-green-600">₹{refundableCredit.toLocaleString()}</p>
                </CardContent>
              </Card>
            </div>

            {packages.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium mb-2">Packages</h3>
                <div className="space-y-2">
                  {packages.map((pkg) => {
                    const availed = Number(packageBalances[pkg.id]?.availed_sessions ?? 0)
                    const displayStatus = pkg.status === 'completed' && availed !== pkg.total_sessions ? 'active' : pkg.status
                    return <Link key={pkg.id} href={`/billing/packages/${pkg.id}`} className="block">
                      <Card className="transition-colors hover:bg-muted/50">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-medium">{pkg.name}</p>
                            <Badge className={statusColors[displayStatus] || ''}>{displayStatus}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{availed} availed · {Number(packageBalances[pkg.id]?.scheduled_sessions ?? 0)} scheduled · {pkg.total_sessions} total</p>
                          <p className="text-sm text-muted-foreground">Quote ₹{Number(packageBalances[pkg.id]?.quote_amount ?? pkg.total_amount).toLocaleString()} · Net received ₹{Number(packageBalances[pkg.id]?.net_received ?? 0).toLocaleString()} · Due ₹{Number(packageBalances[pkg.id]?.due_amount ?? 0).toLocaleString()} · Refundable credit ₹{Number(packageBalances[pkg.id]?.refundable_credit ?? 0).toLocaleString()}</p>
                          {displayStatus === 'completed' && packageBalances[pkg.id]?.completed_at && <p className="text-xs text-green-700">Completed {format(parseISO(packageBalances[pkg.id].completed_at!), 'dd MMM yyyy')}</p>}
                        </CardContent>
                      </Card>
                    </Link>
                  })}
                </div>
              </div>
            )}

            {payments.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">Payment History</h3>
                <div className="space-y-2">
                  {visiblePayments.map((payment) => (
                    <Card key={payment.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">₹{Number(payment.amount).toLocaleString()}</p>
                            <p className="text-sm text-muted-foreground">{payment.payment_method} · {getFundingScopeLabel(payment.funding_scope ?? (payment.package_id ? 'package' : 'ordinary'))}{payment.status === 'voided' ? ' · voided' : ''}</p>
                          </div>
                          <p className="text-sm text-muted-foreground">{formatDateOnly(payment.date, 'dd MMM yyyy')}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {payments.length > PAYMENT_LIST_INITIAL && (
                    <button
                      onClick={() => setShowAllPayments((v) => !v)}
                      className="text-sm text-muted-foreground w-full text-center py-2 hover:underline"
                    >
                      {showAllPayments ? 'Show less' : `Show all ${payments.length} payments`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {isAdmin && (
        <AlertDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (deleting) return
            setDeleteOpen(open)
            if (!open) setConfirmText('')
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this patient?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes <span className="font-medium">{patient.name}</span> only when the patient has
                no billing history. Patients with billing history are retained to preserve the audit trail. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="confirm-delete-patient">
                Type <span className="font-medium">{patient.name}</span> to confirm
              </Label>
              <Input
                id="confirm-delete-patient"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={deleting}
                autoComplete="off"
                data-testid="confirm-delete-patient-input"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting || !canConfirmDelete}
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={(event) => {
                  event.preventDefault()
                  confirmDeletePatient()
                }}
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  'Delete'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
