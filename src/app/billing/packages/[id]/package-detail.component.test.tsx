import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { PackageDetail, type PackageSession } from './package-detail'

afterEach(cleanup)

const sessions: PackageSession[] = [
  { id: 's1', appointmentReferenceId: 'a1', date: '2026-07-02', time: '09:00:00', type: 'Clinic', fee: 800, appointmentStatus: 'completed', lifecycle: 'availed', releasedAt: null, releaseReason: null },
  { id: 's2', appointmentReferenceId: 'a2', date: '2026-07-09', time: '11:00:00', type: 'Clinic', fee: 1000, appointmentStatus: 'scheduled', lifecycle: 'scheduled', releasedAt: null, releaseReason: null },
  { id: 's3', appointmentReferenceId: 'a3', date: '2026-07-01', time: '11:00:00', type: 'Clinic', fee: 800, appointmentStatus: 'cancelled', lifecycle: 'released', releasedAt: '2026-07-01T12:00:00Z', releaseReason: 'Appointment cancelled' },
  { id: 's4', appointmentReferenceId: 'deleted-appt', date: null, time: null, type: null, fee: null, appointmentStatus: null, lifecycle: 'released', releasedAt: '2026-07-03T12:00:00Z', releaseReason: 'Appointment deleted' },
]

function renderDetail(overrides: Partial<React.ComponentProps<typeof PackageDetail>> = {}) {
  return render(
    <PackageDetail
      patientName="Asha Rao"
      name="10-Session Physiotherapy Package"
      status="active"
      availedSessions={2}
      scheduledSessions={1}
      totalSessions={10}
      quoteAmount={8000}
      netReceived={7800}
      appliedAmount={2400}
      dueAmount={0}
      refundableCredit={5400}
      completedAt={null}
      sessions={sessions}
      {...overrides}
    />,
  )
}

describe('PackageDetail', () => {
  it('lists the dates on which sessions were taken under the package', () => {
    renderDetail()

    const heading = screen.getByRole('heading', { name: /Session history/ })
    expect(heading.textContent).toContain('4')
    expect(screen.getByText('02 Jul 2026')).toBeTruthy()
    expect(screen.getByText('09 Jul 2026')).toBeTruthy()
    // Package identity + progress are shown too.
    expect(screen.getAllByText('10-Session Physiotherapy Package').length).toBeGreaterThan(0)
    expect(screen.getByText('2 availed · 1 scheduled · 10 total')).toBeTruthy()
    expect(screen.getByText('Quote')).toBeTruthy()
    expect(screen.getByText('Net received')).toBeTruthy()
    expect(screen.getByText('Applied')).toBeTruthy()
    expect(screen.getByText('Due')).toBeTruthy()
    expect(screen.getByText('Refundable credit')).toBeTruthy()
    expect(screen.getAllByText('Released')).toHaveLength(2)
    expect(screen.getByText(/Appointment cancelled/)).toBeTruthy()
    expect(screen.getByText(/Deleted appointment · deleted-appt/)).toBeTruthy()
  })

  it('shows an empty state when no sessions have been taken yet', () => {
    renderDetail({ sessions: [] })
    expect(screen.getByText('No package session history yet.')).toBeTruthy()
    expect(screen.queryByText('02 Jul 2026')).toBeNull()
  })

  it('shows completion date only for a fully availed completed package', () => {
    const { rerender } = renderDetail({
      status: 'completed',
      availedSessions: 10,
      scheduledSessions: 0,
      completedAt: '2026-08-15T10:00:00Z',
    })
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByText(/Completed 15 Aug 2026/)).toBeTruthy()

    rerender(
      <PackageDetail
        patientName="Asha Rao"
        name="10-Session Physiotherapy Package"
        status="completed"
        availedSessions={9}
        scheduledSessions={1}
        totalSessions={10}
        quoteAmount={8000}
        netReceived={8000}
        appliedAmount={7200}
        dueAmount={0}
        refundableCredit={800}
        completedAt={null}
        sessions={sessions}
      />,
    )
    expect(screen.queryByText(/^Completed/)).toBeNull()
    expect(screen.getByText('Active')).toBeTruthy()
  })
})
