'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { shouldHideAppChrome } from '@/lib/layout/app-chrome'
import { cn } from '@/lib/utils'
import { clinicNavItems, EXTERNAL_NAV, isNavItemActive } from './nav-items'


type BottomNavProps = { canViewBilling?: boolean; variant?: 'clinic' | 'external' }

export function BottomNav({ canViewBilling = false, variant = 'clinic' }: BottomNavProps) {
  const pathname = usePathname()
  if (shouldHideAppChrome(pathname)) return null

  const visible = variant === 'external' ? EXTERNAL_NAV : clinicNavItems(canViewBilling)

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
        const isActive = isNavItemActive(item, pathname)
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
