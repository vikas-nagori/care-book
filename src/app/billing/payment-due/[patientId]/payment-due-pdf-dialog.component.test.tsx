import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { PaymentDuePdfDialog } from './payment-due-pdf-dialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function response() {
  return {
    ok: true,
    headers: new Headers({
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="payment-summary-Nayana-2026-09-06-all-regular.pdf"',
    }),
    blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
  }
}

describe('PaymentDuePdfDialog', () => {
  it('posts the selected regular-session scope and downloads the generated PDF', async () => {
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => { void args; return response() })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:payment')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<PaymentDuePdfDialog patientId="patient-1" patientName="Nayana Pai" previousMonth={{ periodMonth: '2026-08', label: 'August 2026' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share payment PDF' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByDisplayValue('previous_month'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate PDF' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/billing/payment-due/patient-1/pdf')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      regularScope: 'previous_month',
      periodMonth: '2026-08',
    })
    expect(screen.getByText('PDF downloaded and ready to share.')).toBeTruthy()
  })

  it('exposes Share PDF after generation when native file sharing is available', async () => {
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => { void args; return response() })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:payment')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) })
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(async () => undefined) })

    render(<PaymentDuePdfDialog patientId="patient-1" patientName="Nayana Pai" previousMonth={{ periodMonth: '2026-08', label: 'August 2026' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share payment PDF' }))
    const dialog = await screen.findByRole('dialog')
    expect(fetchMock).toHaveBeenCalledTimes(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate PDF' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Share PDF' })).toBeTruthy())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share PDF' }))

    await waitFor(() => expect(navigator.share).toHaveBeenCalledWith({ files: [expect.any(File)] }))
  })
})
