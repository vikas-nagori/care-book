'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, CalendarDays, Receipt, Settings } from 'lucide-react'
import { shouldHideAppChrome } from '@/lib/layout/app-chrome'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/',         label: 'Dashboard', icon: LayoutDashboard },
  { href: '/schedule', label: 'Schedule',  icon: CalendarDays },
  { href: '/patients', label: 'Patients',  icon: Users },
  { href: '/billing',  label: 'Billing',   icon: Receipt },
  { href: '/settings', label: 'Settings',  icon: Settings },
]

type BottomNavProps = { canViewBilling: boolean }

export function BottomNav({ canViewBilling }: BottomNavProps) {
  const pathname = usePathname()
  if (shouldHideAppChrome(pathname)) return null

  const visible = canViewBilling
    ? navItems
    : navItems.filter((item) => item.href !== '/billing')

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 grid md:hidden"
      style={{
        background: 'var(--ph-surface)',
        borderTop: '1px solid var(--ph-line)',
        gridTemplateColumns: `repeat(${visible.length}, 1fr)`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {visible.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== '/' && pathname.startsWith(item.href))
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-2',
              isActive
                ? 'text-[color:var(--ph-accent)]'
                : 'text-[color:var(--ph-ink-4)]'
            )}
            style={{ fontSize: 10, letterSpacing: '0.01em' }}
          >
            <item.icon size={19} strokeWidth={isActive ? 2 : 1.6} />
            <span style={{ fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
