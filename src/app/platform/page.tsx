import Link from 'next/link'
import { Building2, Users, ClipboardList } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requirePlatformAdminUser } from '@/lib/platform/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function countRows(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  filters: Record<string, string> = {}
): Promise<number> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value)
  }
  const { count } = await query
  return count ?? 0
}

export default async function PlatformOverviewPage() {
  await requirePlatformAdminUser()
  const adminSupabase = createAdminClient()

  const [
    clinicsActive,
    clinicsBlocked,
    pendingRequests,
    usersActive,
    usersBlocked,
  ] = await Promise.all([
    countRows(adminSupabase, 'clinics', { status: 'active' }),
    countRows(adminSupabase, 'clinics', { status: 'inactive' }),
    countRows(adminSupabase, 'clinic_onboarding_requests', { status: 'pending' }),
    countRows(adminSupabase, 'profiles', { status: 'active' }),
    countRows(adminSupabase, 'profiles', { status: 'blocked' }),
  ])

  const cards = [
    {
      href: '/platform/clinics',
      icon: Building2,
      title: 'Clinics',
      primary: clinicsActive,
      primaryLabel: 'active',
      secondary: clinicsBlocked,
      secondaryLabel: 'blocked',
    },
    {
      href: '/platform/users',
      icon: Users,
      title: 'Users',
      primary: usersActive,
      primaryLabel: 'active',
      secondary: usersBlocked,
      secondaryLabel: 'blocked',
    },
    {
      href: '/platform/clinic-requests',
      icon: ClipboardList,
      title: 'Onboarding requests',
      primary: pendingRequests,
      primaryLabel: 'pending',
      secondary: null,
      secondaryLabel: '',
    },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage clinics, users, and onboarding requests across the platform.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="block">
            <Card className="h-full transition-colors hover:border-primary">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <card.icon className="text-muted-foreground" size={18} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{card.primary}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.primaryLabel}
                  {card.secondary !== null ? ` · ${card.secondary} ${card.secondaryLabel}` : ''}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
