'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, CalendarDays, Receipt, Settings } from 'lucide-react'
import { BrandMark } from '@/components/brand/brand'
import { shouldHideAppChrome } from '@/lib/layout/app-chrome'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/',         label: 'Dashboard', icon: LayoutDashboard },
  { href: '/schedule', label: 'Schedule',  icon: CalendarDays },
  { href: '/patients', label: 'Patients',  icon: Users },
  { href: '/billing',  label: 'Billing',   icon: Receipt },
  { href: '/settings', label: 'Settings',  icon: Settings },
]

type SidebarProps = { canViewBilling: boolean }

export function Sidebar({ canViewBilling }: SidebarProps) {
  const pathname = usePathname()
  if (shouldHideAppChrome(pathname)) return null

  const visible = canViewBilling
    ? navItems
    : navItems.filter((item) => item.href !== '/billing')

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
        <BrandMark size={28} priority />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2, color: 'var(--ph-ink)' }}>
            Care-Book
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ph-ink-4)', letterSpacing: '0.02em', marginTop: 1 }}>
            Clinic workspace
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visible.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href))
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
