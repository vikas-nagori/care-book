'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Building2, Users, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/platform/clinics', label: 'Clinics', icon: Building2, exact: false },
  { href: '/platform/users', label: 'Users', icon: Users, exact: false },
  { href: '/platform/clinic-requests', label: 'Onboarding', icon: ClipboardList, exact: false },
]

export function PlatformNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap gap-1">
      {navItems.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
