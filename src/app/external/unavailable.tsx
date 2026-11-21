import { EXTERNAL_ACCESS_MESSAGE } from '@/lib/external/workspace'
import { logoutFromSettings } from '../settings/actions'
import { WorkspaceNotice } from './workspace-notice'

export function ExternalAccountUnavailable() {
  return (
    <div className="p-4 md:p-6">
      <WorkspaceNotice title="Account unavailable" message={EXTERNAL_ACCESS_MESSAGE}>
        <form action={logoutFromSettings} className="mt-4">
          <button type="submit" className="text-sm font-medium underline underline-offset-4">Log out</button>
        </form>
      </WorkspaceNotice>
    </div>
  )
}
