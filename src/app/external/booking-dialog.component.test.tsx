import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({ createExternalAppointment: vi.fn() }))

import { ExternalBookingDialog } from './booking-dialog'

function renderDialog(defaultDate: string) {
  render(
    <ExternalBookingDialog
      defaultDate={defaultDate}
      minDate="2026-11-21"
      timeZone="Asia/Kolkata"
      patients={[{ id: 'p1', name: 'Asha Patel' }]}
      types={[{ id: 't1', name: 'Clinic' }]}
      getRequestId={() => '00000000-0000-4000-8000-000000000001'}
      clearRequestId={() => {}}
      returnFocus={document.createElement('button')}
      onClose={() => {}}
      onBooked={() => {}}
      onDenied={() => {}}
    />,
  )
  return screen.getByLabelText('Date') as HTMLInputElement
}

describe('external booking dialog date', () => {
  afterEach(cleanup)

  it('does not offer dates before today', () => {
    expect(renderDialog('2026-11-25').min).toBe('2026-11-21')
  })

  it('starts on today when the calendar is showing a past day', () => {
    expect(renderDialog('2026-11-18').value).toBe('2026-11-21')
  })

  it('keeps a future calendar day as the default', () => {
    expect(renderDialog('2026-11-25').value).toBe('2026-11-25')
  })
})
