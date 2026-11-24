'use client'

import { useSignOut } from '@/hooks/use-sign-out'
import { callServerAction } from '@/lib/actions/call-server-action'
import { EXTERNAL_ACCESS_MESSAGE } from '@/lib/external/workspace'
import { logoutFromSettings } from '../settings/actions'
import { WorkspaceNotice } from './workspace-notice'

export function ExternalAccountUnavailable() {
  const { pending, run } = useSignOut(() => callServerAction(() => logoutFromSettings()), 'Not logged out')

  return (
    <div className="p-4 md:p-6">
      <WorkspaceNotice title="Account unavailable" message={EXTERNAL_ACCESS_MESSAGE}>
        <div className="mt-4">
          <button
            type="button"
            className="text-sm font-medium underline underline-offset-4 disabled:opacity-60"
            disabled={pending}
            onClick={() => void run()}
          >
            {pending ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      </WorkspaceNotice>
    </div>
  )
}
