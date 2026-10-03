import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const state = vi.hoisted(() => ({ role: 'admin', failed: new Set<string>(), queried: [] as string[] }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: async () => ({ role: state.role, id: 'user' }) }))
vi.mock('@/lib/timezone/server', () => ({ getUserTimeZone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  from(table: string) {
    state.queried.push(table)
    const result = {
      data: state.failed.has(table) ? null : [], count: state.failed.has(table) ? null : 0,
      error: state.failed.has(table) ? { code: '08006', message: 'private database detail' } : null,
    }
    const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) }
    for (const method of ['select', 'gte', 'lte', 'order', 'eq', 'or']) chain[method] = () => chain
    return chain
  },
}) }))
vi.mock('./dashboard-new-appointment', () => ({ DashboardNewAppointmentButton: () => null, DashboardNewAppointmentMobile: () => null }))
vi.mock('./dashboard-reminders', () => ({ DashboardReminders: () => null }))
vi.mock('./dashboard-date', () => ({ DashboardDate: () => null }))
import DashboardPage from './page'

beforeEach(() => { state.role = 'admin'; state.failed.clear(); state.queried = []; vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(cleanup)

it('displays legitimate zero amounts for successful empty datasets', async () => {
  render(await DashboardPage())
  expect(screen.getByRole('link', { name: /This month/ }).textContent).toContain('₹0')
  expect(screen.queryByText('Unable to load')).toBeNull()
})
for (const [table, tile] of [
  ['patient_billing_balances_v2', 'Outstanding'], ['payments', 'This month'],
  ['refunds', 'This month'], ['refund_reversals', 'This month'], ['patients', 'This week'],
]) {
  it(`does not fabricate a zero when ${table} fails`, async () => {
    state.failed.add(table)
    render(await DashboardPage())
    const text = screen.getByRole('link', { name: new RegExp(tile) }).textContent
    expect(text).toContain('Unable to load')
    expect(text).not.toContain('₹0')
    expect(text).not.toContain('0 total patients')
    expect(document.body.textContent).not.toContain('private database detail')
  })
}
it('keeps billing queries and tiles absent for staff', async () => {
  state.role = 'staff'
  render(await DashboardPage())
  expect(screen.queryByRole('link', { name: /Outstanding|This month/ })).toBeNull()
  expect(state.queried).not.toContain('payments')
  expect(state.queried).not.toContain('patient_billing_balances_v2')
})
it('recovers after a refresh without retaining failed state', async () => {
  state.failed.add('payments')
  const view = render(await DashboardPage())
  expect(screen.getByText('Unable to load')).toBeTruthy()
  state.failed.clear()
  view.rerender(await DashboardPage())
  expect(screen.queryByText('Unable to load')).toBeNull()
})
