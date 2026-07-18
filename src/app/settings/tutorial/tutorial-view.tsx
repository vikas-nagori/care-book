'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleCheckBig,
  ClipboardCheck,
  IndianRupee,
  LayoutDashboard,
  RotateCcw,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'
import {
  clampTutorialStepIndex,
  getTutorialProgress,
  type TutorialIcon,
  type TutorialStep,
} from '@/lib/tutorial/tutorial-steps'

const tutorialIcons: Record<TutorialIcon, LucideIcon> = {
  sparkles: Sparkles,
  dashboard: LayoutDashboard,
  schedule: CalendarDays,
  patients: Users,
  session: ClipboardCheck,
  billing: IndianRupee,
  settings: Settings,
  finish: CircleCheckBig,
}

type TutorialViewProps = {
  steps: TutorialStep[]
}

export function TutorialView({ steps }: TutorialViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const tutorialTopRef = useRef<HTMLDivElement>(null)

  if (steps.length === 0) {
    return (
      <div className="mx-auto min-h-full max-w-2xl px-4 pb-8 md:px-6 md:py-8">
        <MobilePageHeader title="App tutorial" backHref="/settings" />
        <div className="mt-6 rounded-xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Tutorial unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The tutorial could not be loaded right now.
          </p>
          <Button asChild className="mt-6 min-h-[44px]">
            <Link href="/settings">Return to settings</Link>
          </Button>
        </div>
      </div>
    )
  }

  const safeIndex = clampTutorialStepIndex(currentIndex, steps.length)
  const step = steps[safeIndex]
  const StepIcon = tutorialIcons[step.icon]
  const isFirstStep = safeIndex === 0
  const isLastStep = safeIndex === steps.length - 1

  function moveTo(index: number) {
    setCurrentIndex(clampTutorialStepIndex(index, steps.length))
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    tutorialTopRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  return (
    <div
      ref={tutorialTopRef}
      className="mx-auto flex min-h-full max-w-2xl flex-col px-4 pb-8 md:px-6 md:py-8"
    >
      <MobilePageHeader title="App tutorial" backHref="/settings" />

      <Link
        href="/settings"
        className="mb-6 hidden min-h-[44px] items-center gap-2 self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
      >
        <ArrowLeft aria-hidden="true" />
        Back to settings
      </Link>

      <div className="mb-4 mt-5 space-y-2 md:mt-0">
        <div className="flex items-center justify-between gap-4 text-xs font-medium text-muted-foreground">
          <span>Step {safeIndex + 1} of {steps.length}</span>
          <span>{Math.round(getTutorialProgress(safeIndex, steps.length))}%</span>
        </div>
        <div
          aria-label="Tutorial progress"
          aria-valuemax={steps.length}
          aria-valuemin={1}
          aria-valuenow={safeIndex + 1}
          className="h-2 overflow-hidden rounded-full bg-[var(--ph-bg-soft)]"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-[var(--ph-accent)] transition-[width] duration-300"
            style={{ width: `${getTutorialProgress(safeIndex, steps.length)}%` }}
          />
        </div>
      </div>

      <p aria-atomic="true" aria-live="polite" className="sr-only">
        Step {safeIndex + 1} of {steps.length}: {step.title}
      </p>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b bg-[var(--ph-bg-soft)] p-5 sm:p-6">
          <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-[var(--ph-accent)] text-white shadow-sm">
            <StepIcon aria-hidden="true" size={24} strokeWidth={1.8} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ph-accent)]">
            {step.eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {step.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {step.description}
          </p>
        </div>

        <div className="p-5 sm:p-6">
          <ul className="space-y-4">
            {step.checklist.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-foreground">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--ph-accent-soft)] text-[var(--ph-accent)]">
                  <Check aria-hidden="true" size={13} strokeWidth={2.5} />
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {step.actions && step.actions.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2 border-t pt-5">
              {step.actions.map((action) => (
                <Button
                  key={`${action.href}-${action.label}`}
                  asChild
                  variant="outline"
                  className="min-h-[44px] flex-1 sm:flex-none"
                >
                  <Link href={action.href}>{action.label}</Link>
                </Button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          disabled={isFirstStep}
          onClick={() => moveTo(safeIndex - 1)}
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>

        {isLastStep ? (
          <Button asChild className="min-h-[44px]">
            <Link href="/settings">Finish</Link>
          </Button>
        ) : (
          <Button
            type="button"
            className="min-h-[44px]"
            onClick={() => moveTo(safeIndex + 1)}
          >
            Next
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>

      {isLastStep && (
        <button
          type="button"
          className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 self-center px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => moveTo(0)}
        >
          <RotateCcw aria-hidden="true" size={16} />
          Start again
        </button>
      )}
    </div>
  )
}
