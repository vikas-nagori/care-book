import { describe, expect, it, vi } from 'vitest'

import { canSharePdf, sharePdf } from './payment-due-pdf-share'

function pdfFile() {
  return new File(['pdf'], 'payment-due.pdf', { type: 'application/pdf' })
}

describe('payment due PDF sharing', () => {
  it('uses the native file share capability when the device supports it', () => {
    const share = vi.fn(async () => undefined)
    const canShare = vi.fn(() => true)
    const navigatorLike = { share, canShare }

    expect(canSharePdf(pdfFile(), navigatorLike)).toBe(true)
    expect(canShare).toHaveBeenCalledWith({ files: [expect.any(File)] })
  })

  it('does not advertise sharing when file sharing is unavailable', () => {
    expect(canSharePdf(pdfFile(), { share: vi.fn() })).toBe(false)
    expect(canSharePdf(pdfFile(), { canShare: vi.fn(() => false), share: vi.fn() })).toBe(false)
  })

  it('returns a cancellation result without showing an error for an intentional dismiss', async () => {
    const error = new DOMException('dismissed', 'AbortError')
    const result = await sharePdf(pdfFile(), { share: vi.fn(async () => { throw error }), canShare: vi.fn(() => true) })

    expect(result).toBe('cancelled')
  })

  it('returns unsupported when the browser cannot share files', async () => {
    expect(await sharePdf(pdfFile(), { share: vi.fn() })).toBe('unsupported')
  })
})
