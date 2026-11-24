import type { Metadata } from 'next'
import { AccountSummary } from '../../settings/account-summary'
import { requireExternalProfile } from '../load-workspace'
import { ExternalAccountUnavailable } from '../unavailable'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Account · Care-Book' }

export default async function ExternalAccountPage() {
  const { profile, authorized } = await requireExternalProfile()
  if (!authorized || !profile) return <ExternalAccountUnavailable />
  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-5" style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
        Your account
      </h1>
      <AccountSummary profile={profile} />
    </div>
  )
}
