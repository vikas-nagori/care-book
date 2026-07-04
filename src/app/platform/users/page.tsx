import { requirePlatformAdminUser } from '@/lib/platform/server'
import { isPlatformAdminEmail } from '@/lib/platform/access'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PlatformUserSummary } from '@/lib/supabase/types'
import { UsersList } from './users-list'

type ProfileRow = PlatformUserSummary & {
  clinic?: { name: string | null; status: PlatformUserSummary['clinic_status'] } | { name: string | null; status: PlatformUserSummary['clinic_status'] }[] | null
}

export default async function PlatformUsersPage() {
  await requirePlatformAdminUser()
  const adminSupabase = createAdminClient()

  const { data } = await adminSupabase
    .from('profiles')
    .select('*, clinic:clinics(name, status)')
    .order('created_at', { ascending: false })

  const users: PlatformUserSummary[] = ((data ?? []) as ProfileRow[]).map((row) => {
    const clinic = Array.isArray(row.clinic) ? row.clinic[0] : row.clinic
    return {
      ...row,
      clinic_name: clinic?.name ?? null,
      clinic_status: clinic?.status ?? null,
    }
  })

  const superadminEmails = new Set(
    users.filter((user) => isPlatformAdminEmail(user.email)).map((user) => user.id)
  )

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Block a user to sign them out and prevent them from logging in.
        </p>
      </div>
      <UsersList users={users} superadminIds={Array.from(superadminEmails)} />
    </div>
  )
}
