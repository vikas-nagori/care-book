'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileDown, Loader2, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { canSharePdf, sharePdf } from '@/lib/billing/payment-due-pdf-share'

type RegularScope = 'all_due' | 'previous_month'

type PaymentDuePdfDialogProps = {
  patientId: string
  patientName: string
  previousMonth: { periodMonth: string; label: string }
}

type PreparedPdf = {
  file: File
  objectUrl: string
}

function downloadPdf(objectUrl: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function responseMessage(response: Response) {
  return response.json()
    .then((body: unknown) => (
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : 'Could not generate the payment PDF. Please try again.'
    ))
    .catch(() => 'Could not generate the payment PDF. Please try again.')
}

export function PaymentDuePdfDialog({ patientId, patientName, previousMonth }: PaymentDuePdfDialogProps) {
  const [open, setOpen] = useState(false)
  const [regularScope, setRegularScope] = useState<RegularScope>('all_due')
  const [prepared, setPrepared] = useState<PreparedPdf | null>(null)
  const [loading, setLoading] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const clearPrepared = useCallback(() => {
    requestId.current += 1
    setPrepared((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl)
      return null
    })
  }, [])

  useEffect(() => () => {
    requestId.current += 1
    setPrepared((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl)
      return null
    })
  }, [])

  useEffect(() => {
    clearPrepared()
    setError(null)
  }, [clearPrepared, patientId, patientName, previousMonth.periodMonth])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      clearPrepared()
      setError(null)
      setLoading(false)
      setSharing(false)
    } else {
      setRegularScope('all_due')
      setError(null)
    }
  }

  function handleScopeChange(nextScope: RegularScope) {
    setRegularScope(nextScope)
    clearPrepared()
    setError(null)
  }

  async function handleGenerate() {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)
    setPrepared((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl)
      return null
    })

    try {
      const response = await fetch(`/api/billing/payment-due/${patientId}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regularScope,
          ...(regularScope === 'previous_month' ? { periodMonth: previousMonth.periodMonth } : {}),
        }),
      })
      if (requestId.current !== currentRequest) return
      if (!response.ok) {
        setError(await responseMessage(response))
        return
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLowerCase().includes('application/pdf')) {
        setError('The server returned an invalid payment PDF. Please try again.')
        return
      }
      const blob = await response.blob()
      const contentDisposition = response.headers.get('content-disposition') ?? ''
      const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
      const filename = filenameMatch?.[1] || `payment-summary-${patientName.replace(/\s+/g, '-')}.pdf`
      const file = new File([blob], filename, { type: 'application/pdf' })
      const objectUrl = URL.createObjectURL(blob)
      setPrepared({ file, objectUrl })
      downloadPdf(objectUrl, filename)
    } catch {
      if (requestId.current === currentRequest) setError('Could not generate the payment PDF. Check your connection and try again.')
    } finally {
      if (requestId.current === currentRequest) setLoading(false)
    }
  }

  async function handleShare() {
    if (!prepared) return
    setSharing(true)
    setError(null)
    const result = await sharePdf(prepared.file)
    if (result === 'unsupported') {
      setError('File sharing is not available on this device. The PDF has already been downloaded.')
    } else if (result === 'failed') {
      setError('The PDF could not be shared. The downloaded file is ready to send manually.')
    }
    setSharing(false)
  }

  const shareSupported = prepared ? canSharePdf(prepared.file) : false

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="min-w-[44px] min-h-[44px]" aria-label="Share payment PDF" title="Share payment PDF">
          <Share2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Generate payment PDF</DialogTitle>
          <DialogDescription>
            Create a shareable payment summary for {patientName}. Scheduled appointments are never included.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-3" disabled={loading}>
          <legend className="text-sm font-medium">Regular sessions to include</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <input
              type="radio"
              name="regular-scope"
              value="all_due"
              checked={regularScope === 'all_due'}
              onChange={() => handleScopeChange('all_due')}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium">All regular sessions due</span>
              <span className="block text-xs text-muted-foreground">Every completed regular session that still has an amount due.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <input
              type="radio"
              name="regular-scope"
              value="previous_month"
              checked={regularScope === 'previous_month'}
              onChange={() => handleScopeChange('previous_month')}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium">Previous month only</span>
              <span className="block text-xs text-muted-foreground">Completed regular sessions from {previousMonth.label} with an amount due.</span>
            </span>
          </label>
        </fieldset>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Packages always include the complete package count and completed session dates.
        </p>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {prepared && !error && <p className="text-sm text-emerald-700">PDF downloaded and ready to share.</p>}
        {prepared && !shareSupported && !error && (
          <p className="text-xs text-muted-foreground">Native file sharing is unavailable here. Use the downloaded PDF to send it manually.</p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {prepared && (
            <Button type="button" variant="outline" onClick={handleShare} disabled={!shareSupported || sharing}>
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              Share PDF
            </Button>
          )}
          <Button type="button" onClick={handleGenerate} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {loading ? 'Generating…' : prepared ? 'Generate again' : 'Generate PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
