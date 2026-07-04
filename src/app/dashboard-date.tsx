'use client'

import { useEffect, useState } from 'react'
import { formatDashboardDate } from '@/lib/dashboard/current-date'

export function DashboardDate() {
  const [label, setLabel] = useState('')

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    setLabel(formatDashboardDate(new Date(), timeZone))
  }, [])

  return (
    <p className="text-sm text-muted-foreground" suppressHydrationWarning>
      {label || '\u00A0'}
    </p>
  )
}
