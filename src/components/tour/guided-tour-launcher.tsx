'use client'

import { ArrowRight, HelpCircle } from 'lucide-react'
import { useGuidedTour } from './guided-tour-provider'

/**
 * "Help & Guided Tour" card shown in Settings for every role. Opens the tour
 * on demand — the on-demand launch point described in the design handoff.
 */
export function GuidedTourLauncher() {
  const { openTour } = useGuidedTour()

  return (
    <button
      type="button"
      onClick={openTour}
      className="flex w-full cursor-pointer items-center gap-4 rounded-[14px] border border-[var(--ph-accent)] bg-[linear-gradient(180deg,#ffffff,#fcfaf7)] px-5 py-[18px] text-left font-[inherit] text-[var(--ph-ink)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[11px] bg-[var(--ph-accent-soft)] text-[var(--ph-accent-ink)]">
        <HelpCircle size={23} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-[var(--ph-ink)]">
          Help &amp; Guided Tour
        </span>
        <span className="mt-[3px] block text-[12.5px] text-[var(--ph-ink-3)]">
          A short walkthrough of Care-Book, tailored to your role. Open it any time.
        </span>
      </span>
      <span className="inline-flex h-[38px] shrink-0 items-center gap-[7px] rounded-[9px] bg-[var(--ph-accent)] px-4 text-[13px] font-semibold text-white">
        Start tour
        <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
      </span>
    </button>
  )
}
