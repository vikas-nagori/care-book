import type { Metadata } from 'next'
import { getZonedDate } from '@/lib/timezone'
import { getUserTimeZone } from '@/lib/timezone/server'
import { ExternalPatients } from '../external-patients'
import { loadExternalWorkspace, requireExternalProfile } from '../load-workspace'
import { ExternalAccountUnavailable } from '../unavailable'
import { WorkspaceNotice } from '../workspace-notice'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Patients · Care-Book' }

export default async function ExternalPatientsPage() {
  const [{ authorized }, timeZone] = await Promise.all([requireExternalProfile(), getUserTimeZone()])
  if (!authorized) return <ExternalAccountUnavailable />

  const today = getZonedDate(new Date(), timeZone)
  // Patients and types are all this page needs; one day keeps the appointment list empty-cheap.
  const { workspace, error } = await loadExternalWorkspace(today, today)
  return (
    <div className="p-4 md:p-6">
      {workspace
        ? <ExternalPatients workspace={workspace} todayDate={today} timeZone={timeZone} />
        : <WorkspaceNotice title="Workspace unavailable" message={error} />}
    </div>
  )
}
