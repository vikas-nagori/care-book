import type { ReactNode } from 'react'
import Link from 'next/link'
import { CalendarDays, CircleUserRound, UsersRound } from 'lucide-react'
import { BrandLockup } from '@/components/brand/brand'
import { cn } from '@/lib/utils'
import { RefreshWorkspace } from './workspace-refresh'

export type WorkspaceTab = 'calendar' | 'patients' | 'account'

const tabs = [
  { key: 'calendar', title: 'My Calendar', icon: CalendarDays },
  { key: 'patients', title: 'Shared Patients', icon: UsersRound },
  { key: 'account', title: 'Your Account', icon: CircleUserRound },
] as const

export function ExternalWorkspaceShell({
  children,
  tab,
  date,
}: {
  children: ReactNode
  tab?: WorkspaceTab
  date?: string
}) {
  return (
    <div className="min-h-full bg-muted/30">
      <RefreshWorkspace />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-10 gap-y-3 px-4 pt-4 sm:px-6 md:pt-0">
          <BrandLockup markSize={36} className="py-1 md:py-4" />
          {tab && (
            <nav aria-label="External workspace" className="grid w-full grid-cols-3 gap-1 sm:flex md:w-auto">
              {tabs.map(({ key, title, icon: Icon }) => (
                <Link
                  key={key}
                  href={{ pathname: '/external', query: { tab: key, date } }}
                  aria-current={tab === key ? 'page' : undefined}
                  prefetch={false}
                  className={cn(
                    'flex min-h-12 items-center justify-center gap-2 border-b-2 px-1.5 text-center text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:text-sm',
                    tab === key
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon size={17} aria-hidden="true" className="hidden shrink-0 sm:block" />
                  {title}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 md:py-9">{children}</div>
    </div>
  )
}

export function WorkspaceNotice({ title, message }: { title: string; message: string }) {
  return (
    <div role="status" className="rounded-lg border border-dashed bg-card px-5 py-10 text-center">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
