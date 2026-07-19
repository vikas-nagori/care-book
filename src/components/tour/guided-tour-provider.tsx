'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { TourRole } from '@/lib/tour/content'
import { GuidedTour } from './guided-tour'

/**
 * localStorage flag that records the tour has been shown once. Per-device by
 * design (the chosen persistence model) — clearing site data re-arms the
 * first-run auto-open.
 */
const TOUR_SEEN_KEY = 'care-book:guided-tour-seen'

type GuidedTourContextValue = {
  /** Open the guided tour on demand (e.g. from the Settings launcher). */
  openTour: () => void
}

const GuidedTourContext = createContext<GuidedTourContextValue>({
  openTour: () => {},
})

/** Access the tour controls from anywhere inside {@link GuidedTourProvider}. */
export function useGuidedTour() {
  return useContext(GuidedTourContext)
}

type GuidedTourProviderProps = {
  role: TourRole
  children: ReactNode
}

/**
 * Mounts the guided tour once for the authenticated app and controls when it
 * opens. On a device that has never seen it, the tour auto-opens once; after
 * that it is only re-openable from the Settings launcher. The modal instance
 * stays mounted so the viewer resumes where they left off.
 */
export function GuidedTourProvider({ role, children }: GuidedTourProviderProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let seen = false
    try {
      seen = window.localStorage.getItem(TOUR_SEEN_KEY) === 'true'
    } catch {
      // Private mode / storage disabled — treat as already seen so we never
      // trap the user in a modal we can't remember dismissing.
      seen = true
    }
    if (!seen) {
      setOpen(true)
      try {
        window.localStorage.setItem(TOUR_SEEN_KEY, 'true')
      } catch {
        // Ignore write failures; the tour still works this session.
      }
    }
  }, [])

  return (
    <GuidedTourContext.Provider value={{ openTour: () => setOpen(true) }}>
      {children}
      <GuidedTour role={role} open={open} onOpenChange={setOpen} />
    </GuidedTourContext.Provider>
  )
}
