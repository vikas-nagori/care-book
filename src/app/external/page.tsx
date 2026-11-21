import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getExternalScheduleRange } from '@/lib/external/calendar'
import { getUserTimeZone } from '@/lib/timezone/server'
import { ExternalSchedule } from './external-schedule'
import { loadExternalWorkspace, requireExternalProfile } from './load-workspace'
import { ExternalAccountUnavailable } from './unavailable'
import { WorkspaceNotice } from './workspace-notice'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Schedule · Care-Book' }

type SearchParams = Promise<{ tab?: string; date?: string }>

export default async function ExternalSchedulePage({ searchParams }: { searchParams: SearchParams }) {
  const [{ authorized }, params, timeZone] = await Promise.all([requireExternalProfile(), searchParams, getUserTimeZone()])
  // Links from before the workspace had its own pages.
  if (params.tab === 'patients' || params.tab === 'account') redirect(`/external/${params.tab}`)
  if (!authorized) return <ExternalAccountUnavailable />

  const range = getExternalScheduleRange(params.date, new Date(), timeZone)
  const { workspace, error } = await loadExternalWorkspace(range.clinicDates.startDate, range.clinicDates.endDate)
  return (
    <div className="p-4 md:p-6">
      {workspace ? (
        <ExternalSchedule
          workspace={workspace}
          selectedDate={range.selectedDate}
          todayDate={range.today}
          railDates={range.railDates}
          timeZone={timeZone}
        />
      ) : (
        <WorkspaceNotice title="Workspace unavailable" message={error} />
      )}
    </div>
  )
}
