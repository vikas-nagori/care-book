import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { PackageDetail, type PackageSession } from './package-detail'

afterEach(cleanup)

const sessions: PackageSession[] = [
  { id: 's1', date: '2026-07-02', time: '09:00:00', type: 'Clinic', fee: 800, status: 'completed' },
  { id: 's2', date: '2026-07-09', time: '11:00:00', type: 'Home', fee: 1000, status: 'completed' },
]

function renderDetail(overrides: Partial<React.ComponentProps<typeof PackageDetail>> = {}) {
  return render(
    <PackageDetail
      patientName="Asha Rao"
      name="10-Session Physiotherapy Package"
      status="active"
      usedSessions={2}
      totalSessions={10}
      paidAmount={8000}
      totalAmount={8000}
      sessions={sessions}
      {...overrides}
    />,
  )
}

describe('PackageDetail', () => {
  it('lists the dates on which sessions were taken under the package', () => {
    renderDetail()

    const heading = screen.getByRole('heading', { name: /Sessions taken/ })
    expect(heading.textContent).toContain('2')
    expect(screen.getByText('02 Jul 2026')).toBeTruthy()
    expect(screen.getByText('09 Jul 2026')).toBeTruthy()
    // Package identity + progress are shown too.
    expect(screen.getAllByText('10-Session Physiotherapy Package').length).toBeGreaterThan(0)
    expect(screen.getByText('2 availed · 8 due · 10 total')).toBeTruthy()
  })

  it('shows an empty state when no sessions have been taken yet', () => {
    renderDetail({ sessions: [] })
    expect(screen.getByText('No sessions have been taken under this package yet.')).toBeTruthy()
    expect(screen.queryByText('02 Jul 2026')).toBeNull()
  })
})
