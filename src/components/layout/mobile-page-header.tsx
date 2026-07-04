'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

type MobilePageHeaderProps =
  | { title: string; onBack: () => void; backHref?: never; action?: ReactNode }
  | { title: string; backHref: string; onBack?: never; action?: ReactNode }
  | { title: string; onBack?: never; backHref?: never; action?: ReactNode }

export function MobilePageHeader({ title, onBack, backHref, action }: MobilePageHeaderProps) {
  // -mx-4 cancels the px-4 page wrapper so the header runs edge-to-edge. Update if used inside px-6.
  return (
    <div
      className="sticky top-0 z-40 flex items-center gap-2 px-4 pb-2 md:hidden -mx-4"
      style={{
        paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))',
        background: 'var(--ph-surface)',
        borderBottom: '1px solid var(--ph-line)',
        color: 'var(--ph-ink)',
      }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px]"
          aria-label="Go back"
        >
          <ArrowLeft size={20} />
        </button>
      )}

      {!onBack && backHref && (
        <Link
          href={backHref}
          className="flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px]"
          aria-label="Go back"
        >
          <ArrowLeft size={20} />
        </Link>
      )}

      <span className="flex-1 text-base font-semibold truncate">{title}</span>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
