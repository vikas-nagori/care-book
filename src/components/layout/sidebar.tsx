'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandMark } from '@/components/brand/brand'
import { shouldHideAppChrome } from '@/lib/layout/app-chrome'
import { cn } from '@/lib/utils'
import { clinicNavItems, EXTERNAL_NAV, isNavItemActive } from './nav-items'


type SidebarProps = { canViewBilling?: boolean; variant?: 'clinic' | 'external' }

export function Sidebar({ canViewBilling = false, variant = 'clinic' }: SidebarProps) {
  const pathname = usePathname()
  if (shouldHideAppChrome(pathname)) return null

  const visible = variant === 'external' ? EXTERNAL_NAV : clinicNavItems(canViewBilling)

  return (
    <aside
      className="hidden md:flex md:flex-col"
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--ph-bg)',
        borderRight: '1px solid var(--ph-line)',
        padding: '20px 14px',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 22px' }}>
        <BrandMark size={28} preload />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2, color: 'var(--ph-ink)' }}>
            Care-Book
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ph-ink-4)', letterSpacing: '0.02em', marginTop: 1 }}>
            {variant === 'external' ? 'External workspace' : 'Clinic workspace'}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visible.map((item) => {
          const isActive = isNavItemActive(item, pathname)
          return (
            <Link key={item.href} href={item.href} className={cn('ph-nav-link', isActive && 'active')}>
              <item.icon size={16} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

    </aside>
  )
}
