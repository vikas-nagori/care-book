import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { evaluateRoleAccess } from '@/lib/auth-access'
import { getExternalCalendarDay } from '@/lib/external/calendar'
import { EXTERNAL_ACCESS_MESSAGE, projectExternalWorkspace } from '@/lib/external/workspace'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'
import { getUserTimeZone } from '@/lib/timezone/server'
import { AccountSummary } from '../settings/account-summary'
import { logoutFromSettings } from '../settings/actions'
import { ExternalWorkspaceContent } from './workspace-content'
import { ExternalWorkspaceShell, WorkspaceNotice } from './workspace-shell'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'External workspace · Care-Book' }

type SearchParams = Promise<{ tab?: string; date?: string }>

async function loadWorkspace(startDate: string, endDate: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('external_workspace', {
      p_start_date: startDate,
      p_end_date: endDate,
    })
    if (error?.code === '42501') return { error: EXTERNAL_ACCESS_MESSAGE }
    if (!error) {
      const workspace = projectExternalWorkspace(data)
      if (workspace) return { workspace }
    }
    logger.warn('external/loadWorkspace', 'Workspace RPC failed.', { code: error?.code })
  } catch {
    logger.warn('external/loadWorkspace', 'Unable to load workspace.')
  }
  return { error: 'Unable to load your workspace. Try refreshing the page.' }
}

export default async function ExternalPage({ searchParams }: { searchParams: SearchParams }) {
  const [profile, params, timeZone] = await Promise.all([getCurrentProfile(), searchParams, getUserTimeZone()])
  if (profile && profile.role !== 'external_staff') redirect('/')
  const day = getExternalCalendarDay(params.date, new Date(), timeZone)
  const tab = params.tab === 'patients' || params.tab === 'account' ? params.tab : 'calendar'

  if (!profile || evaluateRoleAccess(profile, ['external_staff']) !== 'authorized') {
    return (
      <ExternalWorkspaceShell>
        <WorkspaceNotice title="Account unavailable" message={EXTERNAL_ACCESS_MESSAGE} />
        <form action={logoutFromSettings}>
          <button type="submit" className="text-sm font-medium underline underline-offset-4">Log out</button>
        </form>
      </ExternalWorkspaceShell>
    )
  }

  if (tab === 'account') {
    return (
      <ExternalWorkspaceShell tab={tab} date={day.selectedDate}>
        <AccountSummary profile={profile} logoutAction={logoutFromSettings} />
      </ExternalWorkspaceShell>
    )
  }

  const { workspace, error } = await loadWorkspace(day.clinicDates.startDate, day.clinicDates.endDate)
  return (
    <ExternalWorkspaceShell tab={tab} date={day.selectedDate}>
      {workspace ? (
        <ExternalWorkspaceContent
          workspace={workspace}
          tab={tab}
          selectedDate={day.selectedDate}
          today={day.today}
          dayStart={day.start.toISOString()}
          dayEnd={day.end.toISOString()}
          timeZone={timeZone}
        />
      ) : (
        <WorkspaceNotice title="Workspace unavailable" message={error} />
      )}
    </ExternalWorkspaceShell>
  )
}
