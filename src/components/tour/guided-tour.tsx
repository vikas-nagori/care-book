'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import Image from 'next/image'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ArrowRight, Check, Monitor, ShieldCheck, X } from 'lucide-react'
import {
  getChaptersForRole,
  getGroupsForRole,
  type TourChapter,
  type TourChapterId,
  type TourRole,
} from '@/lib/tour/content'
import { resolveTourDevice, type TourMockupDevice } from '@/lib/tour/device'
import { DESKTOP_MOCKUPS, MOBILE_MOCKUPS } from './tour-mockups'

type GuidedTourProps = {
  role: TourRole
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Matches the Tailwind `md` breakpoint below which the tour renders full-screen.
const TOUR_DESKTOP_MEDIA_QUERY = '(min-width: 768px)'

// The width the desktop mockups + their step-pin coordinates are authored for.
const DESIGN_WIDTH = 660

function subscribeToViewport(onChange: () => void) {
  const mediaQuery = window.matchMedia(TOUR_DESKTOP_MEDIA_QUERY)
  mediaQuery.addEventListener('change', onChange)
  return () => mediaQuery.removeEventListener('change', onChange)
}

function getViewportSnapshot() {
  return window.matchMedia(TOUR_DESKTOP_MEDIA_QUERY).matches
}

/**
 * `true` when the viewport is desktop-width. Mobile webapp users start on the
 * mobile mockup automatically; the SSR fallback assumes desktop.
 */
function useIsDesktopViewport() {
  return useSyncExternalStore(subscribeToViewport, getViewportSnapshot, () => true)
}

/**
 * Role-aware guided tour modal. Chapters and copy come from
 * {@link getChaptersForRole}; the screen recreations are static illustrations
 * in {@link DESKTOP_MOCKUPS}/{@link MOBILE_MOCKUPS} with interactive step
 * hotspots overlaid on top. Position resumes where the viewer left off because
 * this component stays mounted while the modal is closed.
 */
export function GuidedTour({ role, open, onOpenChange }: GuidedTourProps) {
  const [chapterId, setChapterId] = useState<TourChapterId | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  // A preview choice is available only while the viewport remains desktop-width.
  const [deviceOverride, setDeviceOverride] = useState<TourMockupDevice | null>(null)
  const isDesktopViewport = useIsDesktopViewport()
  const device = resolveTourDevice(isDesktopViewport, deviceOverride)
  const isMobile = device === 'mobile'

  useEffect(() => {
    if (!isDesktopViewport) setDeviceOverride(null)
  }, [isDesktopViewport])

  const chapters = getChaptersForRole(role)
  const groups = getGroupsForRole(role)

  // Fall back to the first chapter if the stored id isn't in this role's track
  // (e.g. the signed-in role changed since the tour was last opened).
  const current: TourChapter =
    chapters.find((chapter) => chapter.id === chapterId) ?? chapters[0]
  const currentIndex = chapters.findIndex((chapter) => chapter.id === current.id)
  const step = Math.min(stepIndex, current.steps.length - 1)
  const activeStep = current.steps[step]

  // The desktop illustrations are authored at DESIGN_WIDTH; on screens narrower
  // than that we scale the whole preview — art plus its overlaid step pins — so
  // nothing reflows and the pins stay aligned. Mobile mockups are phone-shaped.
  const stageRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)
  useEffect(() => {
    if (!open) return
    const el = stageRef.current
    if (!el) return
    const measure = () => setAvailableWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [open])
  const scaleToFit =
    !isMobile && availableWidth !== null && availableWidth < DESIGN_WIDTH
  const stageScale = scaleToFit ? availableWidth / DESIGN_WIDTH : 1

  const isLastStep = step === current.steps.length - 1
  const isLastChapter = currentIndex === chapters.length - 1
  const isFirstStep = currentIndex === 0 && step === 0

  function goToChapter(id: TourChapterId) {
    setChapterId(id)
    setStepIndex(0)
  }

  function next() {
    if (step < current.steps.length - 1) {
      setStepIndex(step + 1)
      return
    }
    if (currentIndex < chapters.length - 1) {
      setChapterId(chapters[currentIndex + 1].id)
      setStepIndex(0)
      return
    }
    onOpenChange(false)
  }

  function prev() {
    if (step > 0) {
      setStepIndex(step - 1)
      return
    }
    if (currentIndex > 0) {
      const previous = chapters[currentIndex - 1]
      setChapterId(previous.id)
      setStepIndex(previous.steps.length - 1)
    }
  }

  const nextLabel = isLastStep
    ? isLastChapter
      ? 'Finish'
      : 'Next chapter'
    : 'Next'

  const mockupHtml = isMobile
    ? MOBILE_MOCKUPS[current.id]
    : DESKTOP_MOCKUPS[current.id]

  const progressPercent = Math.round(((currentIndex + 1) / chapters.length) * 100)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[100] bg-[rgba(26,24,20,0.55)] backdrop-blur-[3px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          aria-label="Care-Book guided tour"
          className="fixed left-1/2 top-1/2 z-[100] flex h-[100dvh] w-screen max-w-none -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden bg-[var(--ph-surface)] shadow-[0_24px_70px_rgba(26,24,20,0.4)] outline-none md:h-[min(760px,92vh)] md:w-[1180px] md:max-w-[calc(100vw-48px)] md:grid md:grid-cols-[296px_1fr] md:rounded-2xl"
        >
          {/* ===== Sidebar (chapters) — desktop only ===== */}
          <aside className="hidden min-h-0 flex-col border-r border-[var(--ph-line)] bg-[var(--ph-bg)] md:flex">
            <div className="flex items-center gap-[11px] px-[22px] pb-4 pt-[22px]">
              <Image
                src="/icons/icon.svg"
                alt=""
                width={30}
                height={30}
                unoptimized
                className="shrink-0 rounded-lg"
              />
              <div>
                <div className="text-[13.5px] font-semibold leading-tight tracking-tight">
                  Care-Book tour
                </div>
                <div className="mt-px text-[10.5px] text-[var(--ph-ink-4)]">
                  Learn the essentials
                </div>
              </div>
            </div>
            <div className="px-[22px] pb-[14px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ph-accent-soft)] px-2.5 py-[5px] text-[11px] font-semibold text-[var(--ph-accent-ink)]">
                <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />
                Viewing as {role === 'admin' ? 'Admin' : 'Staff'}
              </span>
            </div>
            <nav className="flex-1 overflow-y-auto px-[14px] pb-[14px] pt-0.5">
              {groups.map((group) => (
                <div key={group} className="mb-[14px]">
                  <div className="px-2 pb-[6px] pt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--ph-ink-4)]">
                    {group}
                  </div>
                  {chapters
                    .filter((chapter) => chapter.group === group)
                    .map((chapter) => {
                      const globalIndex = chapters.findIndex((c) => c.id === chapter.id)
                      const active = chapter.id === current.id
                      const done = globalIndex < currentIndex
                      return (
                        <button
                          key={chapter.id}
                          type="button"
                          onClick={() => goToChapter(chapter.id)}
                          className={
                            'mb-px flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-none px-2 py-2 text-left font-[inherit] transition-colors ' +
                            (active
                              ? 'bg-[var(--ph-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_var(--ph-line)]'
                              : 'bg-transparent hover:bg-[var(--ph-bg-soft)]')
                          }
                        >
                          <span
                            className={
                              'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10.5px] font-bold ' +
                              (active
                                ? 'bg-[var(--ph-accent)] text-white'
                                : done
                                  ? 'bg-[var(--ph-ok-soft)] text-[var(--ph-ok)]'
                                  : 'bg-[var(--ph-bg-soft)] text-[var(--ph-ink-4)] shadow-[inset_0_0_0_1px_var(--ph-line)]')
                            }
                          >
                            {done ? (
                              <Check size={11} strokeWidth={3.2} aria-hidden="true" />
                            ) : (
                              globalIndex + 1
                            )}
                          </span>
                          <span
                            className={
                              'text-[12.5px] leading-[1.25] ' +
                              (active
                                ? 'font-semibold text-[var(--ph-ink)]'
                                : 'font-[450] text-[var(--ph-ink-2)]')
                            }
                          >
                            {chapter.title}
                          </span>
                        </button>
                      )
                    })}
                </div>
              ))}
            </nav>
            <div className="border-t border-[var(--ph-line)] px-[22px] pb-[18px] pt-[14px]">
              <div className="mb-1.5 flex justify-between text-[11px] text-[var(--ph-ink-3)]">
                <span>
                  Chapter {currentIndex + 1} of {chapters.length}
                </span>
              </div>
              <div className="h-[5px] overflow-hidden rounded-[3px] border border-[var(--ph-line)] bg-[var(--ph-bg-soft)]">
                <span
                  className="block h-full rounded-[3px] bg-[var(--ph-accent)]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </aside>

          {/* ===== Main ===== */}
          <section className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_1fr_auto]">
            {/* header */}
            <header className="flex items-start gap-4 border-b border-[var(--ph-line)] px-[26px] pb-4 pt-5">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center gap-[9px] text-[11px] text-[var(--ph-ink-4)]">
                  <span className="font-bold uppercase tracking-[0.06em] text-[var(--ph-accent-ink)]">
                    {current.group}
                  </span>
                  <span className="h-[3px] w-[3px] rounded-full bg-[var(--ph-ink-4)]" />
                  <span className="inline-flex items-center gap-1">
                    <Monitor size={12} strokeWidth={2} aria-hidden="true" />
                    {isMobile ? 'Mobile' : 'Desktop'}
                  </span>
                </div>
                <DialogPrimitive.Title asChild>
                  <h2 className="m-0 text-[20px] font-bold leading-[1.2] tracking-[-0.015em] text-[var(--ph-ink)]">
                    {current.title}
                  </h2>
                </DialogPrimitive.Title>
                <DialogPrimitive.Description asChild>
                  <p className="mt-[7px] max-w-[640px] text-[13px] leading-[1.5] text-[var(--ph-ink-2)]">
                    {current.intro}
                  </p>
                </DialogPrimitive.Description>
              </div>
              {isDesktopViewport ? (
                <div className="mt-0.5 inline-flex shrink-0 rounded-[9px] border border-[var(--ph-line)] bg-[var(--ph-bg-soft)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setDeviceOverride('desktop')}
                    className={segmentClass(!isMobile)}
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeviceOverride('mobile')}
                    className={segmentClass(isMobile)}
                  >
                    Mobile
                  </button>
                </div>
              ) : null}
              <DialogPrimitive.Close
                aria-label="Close tour"
                className="grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[9px] border border-[var(--ph-line)] bg-white text-[var(--ph-ink-3)] hover:text-[var(--ph-ink)]"
              >
                <X size={17} strokeWidth={2} aria-hidden="true" />
              </DialogPrimitive.Close>
            </header>

            {/* stage */}
            <div className="relative flex justify-center overflow-auto bg-[linear-gradient(180deg,#f6f2ec,#faf8f5)] px-5 py-[34px] md:px-[30px]">
              <div ref={stageRef} className="flex w-full max-w-[660px] justify-center">
                <div
                  className="relative"
                  style={
                    scaleToFit
                      ? ({ width: DESIGN_WIDTH, zoom: stageScale } as CSSProperties)
                      : { width: '100%' }
                  }
                >
                  {mockupHtml ? (
                    <div
                      // Static, developer-authored illustration markup — no user
                      // input flows into these strings (see tour-mockups.ts).
                      dangerouslySetInnerHTML={{ __html: mockupHtml }}
                    />
                  ) : null}

                  {/* interactive step hotspots */}
                  <div className="pointer-events-none absolute inset-0">
                    {current.steps.map((s, i) => {
                      const on = i === step
                      const left = isMobile ? 62 : s.x
                      const top = isMobile ? 104 + i * 84 : s.y
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setStepIndex(i)}
                          aria-label={`Step ${i + 1}: ${s.title}`}
                          aria-current={on ? 'step' : undefined}
                          className={
                            'pointer-events-auto absolute grid h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-[12px] font-bold transition-transform ' +
                            (on
                              ? 'z-[2] animate-[pinpulse_1.8s_ease-out_infinite] border-2 border-white bg-[var(--ph-accent)] text-white shadow-[0_2px_6px_rgba(0,0,0,0.25)]'
                              : 'z-[1] border-2 border-[var(--ph-accent)] bg-white text-[var(--ph-accent-ink)] shadow-[0_1px_3px_rgba(0,0,0,0.18)]')
                          }
                          style={{ left: `${left}%`, top: `${top}px` }}
                        >
                          {i + 1}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* step bar */}
            <footer className="border-t border-[var(--ph-line)] bg-white px-[26px] pb-[18px] pt-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-[5px] flex flex-wrap items-center gap-[9px]">
                    <span className="rounded-[5px] bg-[var(--ph-accent-soft)] px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--ph-accent-ink)]">
                      Step {step + 1} of {current.steps.length}
                    </span>
                    <span className="text-[14px] font-semibold text-[var(--ph-ink)]">
                      {activeStep.title}
                    </span>
                  </div>
                  <p className="m-0 max-w-[660px] text-[13px] leading-[1.5] text-[var(--ph-ink-2)]">
                    {activeStep.body}
                  </p>
                  <div className="mt-3 flex gap-1.5">
                    {current.steps.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Go to step ${i + 1}`}
                        onClick={() => setStepIndex(i)}
                        className={
                          'h-1.5 cursor-pointer rounded-[3px] border-none p-0 transition-all ' +
                          (i === step
                            ? 'w-[22px] bg-[var(--ph-accent)]'
                            : 'w-1.5 bg-[var(--ph-line-strong)]')
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-[9px] md:shrink-0 md:pt-0.5">
                  {!(isLastStep && isLastChapter) ? (
                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      className="h-10 cursor-pointer rounded-[9px] border-none bg-transparent px-2.5 font-[inherit] text-[13px] font-semibold text-[var(--ph-ink-3)] hover:text-[var(--ph-ink)]"
                    >
                      Skip tour
                    </button>
                  ) : null}
                  {!isFirstStep ? (
                    <button
                      type="button"
                      onClick={prev}
                      className="h-10 cursor-pointer rounded-[9px] border border-[var(--ph-line-strong)] bg-white px-4 font-[inherit] text-[13px] font-semibold text-[var(--ph-ink-2)]"
                    >
                      Back
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={next}
                    className="inline-flex h-10 cursor-pointer items-center gap-[7px] rounded-[9px] border-none bg-[var(--ph-accent)] px-[18px] font-[inherit] text-[13px] font-semibold text-white"
                  >
                    {nextLabel}
                    <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </footer>
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function segmentClass(active: boolean) {
  return (
    'cursor-pointer rounded-[7px] border-none px-[11px] py-[5px] font-[inherit] text-[11.5px] font-semibold transition-colors ' +
    (active
      ? 'bg-white text-[var(--ph-ink)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
      : 'bg-transparent text-[var(--ph-ink-3)]')
  )
}
