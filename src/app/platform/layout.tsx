import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PlatformNav } from '@/components/platform/platform-nav'
import { requirePlatformAdminUser } from '@/lib/platform/server'
import { signOutFromPlatform } from './actions'

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const admin = await requirePlatformAdminUser()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-primary" size={20} />
              <div>
                <div className="text-base font-semibold leading-tight">Superadmin console</div>
                <div className="text-xs text-muted-foreground">{admin.email}</div>
              </div>
            </div>
            <form action={signOutFromPlatform}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
          <PlatformNav />
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
