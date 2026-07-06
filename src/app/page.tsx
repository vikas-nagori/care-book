import { getCurrentProfile } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { getAppointmentVisibilityFilter } from '@/lib/access/appointment-visibility'
import { createClient } from '@/lib/supabase/server'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { buildPaymentDueRows } from '@/lib/billing/payment-due'
import { formatTime12 } from '@/lib/format-time'
import { logger } from '@/lib/logger'
import Link from 'next/link'
import { CalendarDays, Users, IndianRupee, AlertCircle } from 'lucide-react'
import { DashboardDate } from './dashboard-date'
import { DashboardNewAppointmentButton, DashboardNewAppointmentMobile } from './dashboard-new-appointment'
import type { Appointment } from '@/lib/supabase/types'
import { APPOINTMENT_TYPE_SHORT_LABEL } from '@/lib/appointments/appointment-type'

function Money({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`ph-money ${className}`}>
      <span className="rs">₹</span>
      {n.toLocaleString('en-IN')}
    </span>
  )
}

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    paid:    { cls: 'ok',   label: 'Paid' },
    prepaid: { cls: 'info', label: 'Prepaid' },
    unpaid:  { cls: 'warn', label: 'Due' },
  }
  const m = map[status] ?? { cls: '', label: status }
  return (
    <span className={`ph-badge ${m.cls}`}>
      <span className="ph-badge-dot" />
      {m.label}
    </span>
  )
}


export default async function DashboardPage() {
  const currentProfile = await getCurrentProfile()
  const access = getRestrictedUiAccess(currentProfile)
  const appointmentVisibilityFilter = getAppointmentVisibilityFilter(currentProfile)
  const supabase = await createClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')

  let apptQuery = supabase
    .from('appointments')
    .select('id, date, time, duration_minutes, type, status, payment_status, fee, patient:patients(id, name, phone)')
    .eq('date', today)
    .order('time')

  if (appointmentVisibilityFilter) apptQuery = apptQuery.or(appointmentVisibilityFilter)

  let weekCountQuery = supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .gte('date', weekStart)
    .lte('date', weekEnd)

  if (appointmentVisibilityFilter) weekCountQuery = weekCountQuery.or(appointmentVisibilityFilter)

  // Outstanding (overall) — net due across all completed unpaid sessions minus unspent
  // payment credit, computed the same way as the Billing page's Outstanding tile.
  const dueAppointmentsP = access.canViewBilling
    ? supabase
        .from('appointments')
        .select('id, patient_id, date, status, payment_status, fee, patient:patients(id, name)')
        .eq('status', 'completed')
        .eq('payment_status', 'unpaid')
    : Promise.resolve({ data: [], error: null })

  const allPaymentsP = access.canViewBilling
    ? supabase.from('payments').select('id, patient_id, amount')
    : Promise.resolve({ data: [], error: null })

  const appointmentPaymentsP = access.canViewBilling
    ? supabase.from('appointment_payments').select('payment_id, amount_applied')
    : Promise.resolve({ data: [], error: null })

  const monthRevP = access.canViewBilling
    ? supabase.from('payments').select('amount').gte('date', monthStart).lte('date', monthEnd)
    : Promise.resolve({ data: [], error: null })

  const [
    { data: rawAppts, error: apptError },
    { count: weekCount },
    { data: dueAppointments },
    { data: allPayments },
    { data: appointmentPayments },
    { data: monthPayments },
    { count: totalPatients },
    { data: patients },
    { data: assigneeOptions, error: assigneeOptionsError },
    { data: externalStaffOptions, error: externalStaffOptionsError },
  ] = await Promise.all([
    apptQuery,
    weekCountQuery,
    dueAppointmentsP,
    allPaymentsP,
    appointmentPaymentsP,
    monthRevP,
    supabase.from('patients').select('*', { count: 'exact', head: true }),
    supabase.from('patients').select('id, name').order('name'),
    supabase.from('profiles').select('id, full_name, email, role').order('full_name'),
    supabase
      .from('external_staff')
      .select('id, clinic_id, name, phone, email, notes, status, linked_profile_id, created_by, created_at, updated_at')
      .order('name'),
  ])

  if (apptError) logger.error('Dashboard/appts', apptError)
  if (assigneeOptionsError) logger.error('Dashboard/assigneeOptions', assigneeOptionsError)
  if (externalStaffOptionsError) logger.error('Dashboard/externalStaffOptions', externalStaffOptionsError)

  type ApptRow = Pick<Appointment, 'id' | 'time' | 'duration_minutes' | 'type' | 'status' | 'payment_status' | 'fee'> & {
    patient: { id: string; name: string; phone: string } | null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appts: ApptRow[] = ((rawAppts ?? []) as any[]).map((a) => ({
    ...a,
    patient: Array.isArray(a.patient) ? (a.patient[0] ?? null) : (a.patient ?? null),
  }))

  const paymentDueRows = buildPaymentDueRows({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    appointments: ((dueAppointments ?? []) as any[]).map((a) => ({
      ...a,
      patient: Array.isArray(a.patient) ? (a.patient[0] ?? null) : (a.patient ?? null),
    })),
    payments: allPayments ?? [],
    appointmentPayments: appointmentPayments ?? [],
  })
  const outstanding = paymentDueRows.reduce((s, r) => s + r.netDue, 0)
  const monthRevenue = (monthPayments ?? []).reduce((s, p) => s + Number(p.amount), 0)
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const nowTime = `${nowIST.getHours().toString().padStart(2, '0')}:${nowIST.getMinutes().toString().padStart(2, '0')}`
  const nextAppt = appts.find((a) => a.status === 'scheduled' && a.time.slice(0, 5) >= nowTime)
  const cancelledCount = appts.filter((a) => a.status === 'cancelled').length

  return (
    <div className="flex flex-col overflow-x-hidden p-4 md:p-6 md:pb-10" style={{ gap: 20 }}>

      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
            Today
          </h1>
          <DashboardDate />
        </div>
        <div className="hidden md:flex" style={{ gap: 8, alignItems: 'center' }}>
          <DashboardNewAppointmentButton
            patients={patients ?? []}
            assigneeOptions={assigneeOptions ?? []}
            externalStaffOptions={externalStaffOptions ?? []}
            currentProfileId={currentProfile?.id ?? null}
            canManageExternalStaff={currentProfile?.role === 'admin'}
          />
        </div>
      </div>

      {/* Mobile quick-actions */}
      <div className="md:hidden grid grid-cols-2 gap-2">
        <DashboardNewAppointmentMobile
          patients={patients ?? []}
          assigneeOptions={assigneeOptions ?? []}
          externalStaffOptions={externalStaffOptions ?? []}
          currentProfileId={currentProfile?.id ?? null}
          canManageExternalStaff={currentProfile?.role === 'admin'}
        />
        <Link
          href="/patients"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontSize: 13, fontWeight: 500, padding: '10px 16px', minHeight: 44,
            borderRadius: 8, border: '1px solid var(--ph-line)',
            background: 'var(--ph-surface)', color: 'var(--ph-ink)', textDecoration: 'none',
          }}
        >
          <Users size={15} />Find patient
        </Link>
      </div>

      {/* Mobile-only Up next (shown before stats on mobile) */}
      {nextAppt && (
        <div className="md:hidden">
          <div className="ph-section-h"><h2>Up next</h2></div>
          <Link href={`/schedule/${nextAppt.id}`} style={{
            display: 'block',
            background: 'var(--ph-surface)',
            border: '1px solid var(--ph-line)',
            borderLeft: '3px solid var(--ph-accent)',
            borderRadius: 10, padding: '14px 16px',
            textDecoration: 'none', color: 'inherit',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="font-mono-data" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em' }}>
                {formatTime12(nextAppt.time)}
              </span>
              <span className="ph-badge soft" style={{ textTransform: 'none' }}>
                {APPOINTMENT_TYPE_SHORT_LABEL[nextAppt.type]}
              </span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ph-ink)', marginBottom: 3 }}>
              {nextAppt.patient?.name ?? 'Unknown'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginBottom: 12 }}>
              {nextAppt.duration_minutes}m session
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {nextAppt.fee != null && <Money n={nextAppt.fee} />}
              {access.canViewBilling && <span className="hidden md:inline-flex"><PaymentBadge status={nextAppt.payment_status} /></span>}
            </div>
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/schedule" className="ph-stat ph-stat-link">
          <div className="ph-stat-label"><CalendarDays size={13} /><span>Today</span></div>
          <div className="ph-stat-value">
            {appts.filter((a) => a.status !== 'cancelled').length}
            <span style={{ fontSize: 14, color: 'var(--ph-ink-4)', marginLeft: 6 }}>/ {appts.length}</span>
          </div>
          <div className="ph-stat-meta">{cancelledCount} cancelled · {appts.filter((a) => a.status === 'scheduled').length} to go</div>
        </Link>

        <Link href="/schedule" className="ph-stat ph-stat-link">
          <div className="ph-stat-label"><Users size={13} /><span>This week</span></div>
          <div className="ph-stat-value">{weekCount ?? 0}</div>
          <div className="ph-stat-meta">{totalPatients ?? 0} total patients</div>
        </Link>

        {access.canViewBilling && (
          <>
            <Link href="/billing/metrics/received-this-month" className="ph-stat ph-stat-link">
              <div className="ph-stat-label"><IndianRupee size={13} /><span>This month</span></div>
              <div className="ph-stat-value"><Money n={monthRevenue} /></div>
              <div className="ph-stat-meta">collected</div>
            </Link>
            <Link href="/billing?tab=payment_due" className="ph-stat ph-stat-link">
              <div className="ph-stat-label"><AlertCircle size={13} /><span>Outstanding</span></div>
              <div className="ph-stat-value" style={{ color: outstanding > 0 ? 'var(--ph-warn)' : undefined }}>
                <Money n={outstanding} />
              </div>
              <div className="ph-stat-meta">payment due</div>
            </Link>
          </>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 md:grid" style={{ gridTemplateColumns: '1.5fr 1fr' }}>

        {/* Today's schedule */}
        <div>
          <div className="ph-section-h">
            <h2>Today&apos;s schedule</h2>
            <Link href="/schedule" style={{ fontSize: 12, color: 'var(--ph-ink-3)', textDecoration: 'none' }}>
              View week →
            </Link>
          </div>
          <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
            {appts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
                No appointments scheduled today.
              </div>
            ) : (
              appts.map((a, i) => (
                <Link
                  key={a.id}
                  href={`/schedule/${a.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '12px 16px',
                    borderBottom: i < appts.length - 1 ? '1px solid var(--ph-line)' : 'none',
                    borderLeft: `3px solid ${a.type === 'home_visit' ? 'var(--ph-warn)' : a.status === 'completed' ? 'var(--ph-ok)' : a.status === 'cancelled' ? 'var(--ph-ink-4)' : 'var(--ph-accent)'}`,
                    textDecoration: 'none', color: 'inherit',
                    background: 'var(--ph-surface)',
                    opacity: a.status === 'cancelled' ? 0.5 : a.status === 'completed' ? 0.75 : 1,
                    transition: 'background 0.1s',
                  }}
                  className="hover:bg-[var(--ph-bg-soft)]"
                >
                  <div style={{ minWidth: 48 }}>
                    <div className="font-mono-data" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ph-ink)' }}>
                      {formatTime12(a.time)}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>{a.duration_minutes}m</div>
                  </div>
                  <div style={{ width: 1, height: 28, background: 'var(--ph-line)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                        {a.patient?.name ?? 'Unknown'}
                      </span>
                      <span className="ph-badge soft" style={{ textTransform: 'none', fontSize: 10.5 }}>
                        {APPOINTMENT_TYPE_SHORT_LABEL[a.type]}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    {a.fee != null && <Money n={a.fee} />}
                    {access.canViewBilling && <span className="hidden md:inline-flex"><PaymentBadge status={a.payment_status} /></span>}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {nextAppt && (
            <div className="hidden md:block">
              <div className="ph-section-h"><h2>Up next</h2></div>
              <Link href={`/schedule/${nextAppt.id}`} style={{
                display: 'block',
                background: 'var(--ph-surface)',
                border: '1px solid var(--ph-line)',
                borderLeft: '3px solid var(--ph-accent)',
                borderRadius: 10, padding: '14px 16px',
                textDecoration: 'none', color: 'inherit',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="font-mono-data" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em' }}>
                    {formatTime12(nextAppt.time)}
                  </span>
                  <span className="ph-badge soft" style={{ textTransform: 'none' }}>
                    {APPOINTMENT_TYPE_SHORT_LABEL[nextAppt.type]}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ph-ink)', marginBottom: 3 }}>
                  {nextAppt.patient?.name ?? 'Unknown'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginBottom: 12 }}>
                  {nextAppt.duration_minutes}m session
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {nextAppt.fee != null && <Money n={nextAppt.fee} />}
                  {access.canViewBilling && <PaymentBadge status={nextAppt.payment_status} />}
                </div>
              </Link>
            </div>
          )}

          <div>
            <div className="ph-section-h">
              <h2>Patients</h2>
              <Link href="/patients" style={{ fontSize: 12, color: 'var(--ph-ink-3)', textDecoration: 'none' }}>
                All →
              </Link>
            </div>
            <div style={{
              background: 'var(--ph-surface)', border: '1px solid var(--ph-line)',
              borderRadius: 10, padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div className="ph-avatar" style={{ width: 38, height: 38 }}>
                <Users size={18} strokeWidth={1.75} />
              </div>
              <div>
                <div className="font-mono-data" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em' }}>
                  {totalPatients ?? 0}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>total patients</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
