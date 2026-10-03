'use client'

import { useEffect } from 'react'
import { reportClientError } from '@/lib/observability/report-client-error'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError('App/errorBoundary') }, [])
  return (
    <div role="alert" className="p-6 space-y-3">
      <h1 className="text-lg font-semibold">Unable to load this page</h1>
      <p>Please try again.</p>
      <button className="ph-btn ph-btn-primary" onClick={reset}>Try again</button>
    </div>
  )
}
