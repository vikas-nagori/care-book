# Mobile-First Clinician Flow Plan

## Summary

Make the CRM first-class on phones, focused on the clinician day flow. Preserve existing routes, Supabase data flow, access restrictions, and desktop behavior. Prioritize the clicked mockups: action-first appointment detail and today-first dashboard, with schedule and patient lookup supporting that flow.

## Key Changes

- Add a small mobile UX layer: shared mobile page header/action patterns, safe-area bottom spacing, 44px+ touch targets, mobile-friendly dialogs, compact stat/list/card utilities, and consistent bottom-nav behavior.
- Redesign `/` mobile layout into a "Today" work surface: next appointment, one-tap new appointment, find patient, compact day stats, and scannable today schedule. Keep desktop dashboard unchanged.
- Redesign `/schedule` mobile as day-first: stronger date strip, direct date jump, filter chips, large appointment cards, floating/sticky new appointment action, and week view as secondary.
- Redesign `/schedule/[id]` mobile around action: large appointment summary, patient call/profile actions, thumb-friendly status changes, edit, and session-note entry.
- Improve `/patients` and `/patients/[id]` mobile scanning: sticky/near-top search, quick add, contact-forward profile, non-crowded tabs, and billing hidden for staff exactly as today.
- Give billing/settings a responsive cleanup only: no horizontal overflow, mobile tabs/buttons/forms/dialogs fit cleanly, but no major admin workflow redesign.
- Add install polish only for PWA: align manifest/theme colors, safe-area behavior, and icon availability; do not add offline data sync.

## Known Concrete Fixes (implement first)

### 1. PWA theme color mismatch
`src/app/layout.tsx` `viewport.themeColor` is `#2f5d5a` (accent) but `public/manifest.json` `theme_color` is `#0f172a`. Fix: change `viewport.themeColor` to `#0f172a` so the browser chrome and installed app status bar match.

### 2. Bottom-nav safe-area clipping
`src/app/layout.tsx` uses `pb-16` (64px) on `<main>` to clear the bottom nav. On iPhones with a home indicator, the bottom-nav itself grows by `env(safe-area-inset-bottom)` (~34px), making total nav height ~83px — content clips beneath it. Fix: replace `pb-16` with a `pb-bottom-nav` utility class defined in `globals.css` as `calc(4rem + env(safe-area-inset-bottom, 0px))`.

### 3. New shared mobile components need access prop threading
Any new shared mobile page header component added under `src/components/layout/` must receive the same `canViewBilling` (and any other `getRestrictedUiAccess` flags) as `Sidebar` and `BottomNav` already do via the root layout. Wire these from `layout.tsx` at the point of introduction.

### 4. `maximumScale: 1` decision
`src/app/layout.tsx` sets `maximumScale: 1`, which blocks pinch-zoom. This conflicts with "accessible touch targets" as a goal. Decide before building: keep it (common for installed PWAs) or remove it. Either way, document the choice.

## Public Interfaces / Types

- No database, RLS, Supabase schema, or route contract changes.
- Prefer shared UI primitives/classes over duplicated per-page styling, likely in `src/components/layout` and `src/app/globals.css`.
- Keep role-based UI behavior aligned with existing `getRestrictedUiAccess`, including staff billing/payment visibility and home-visit restrictions.

## Implementation Order

1. **Foundation** — fix `viewport.themeColor`, add `pb-bottom-nav` CSS utility, add shared mobile page header component. These unblock all subsequent steps.
2. **Dashboard `/`** — mobile "Today" surface using foundation primitives.
3. **Schedule `/schedule`** — day-first mobile view.
4. **Appointment detail `/schedule/[id]`** — action-first mobile layout.
5. **Patients `/patients` + `/patients/[id]`** — scanning improvements.
6. **Billing + Settings** — responsive cleanup only (no workflow redesign).
7. **Verify** — lint, build, `npm run test:unit`, manual browser check at listed viewports.

## Test Plan

- Run `npm run test:unit`, `npm run lint`, and `npm run build` after shared helper changes and again after all pages are done.
- Browser-check mobile viewports: `375x812`, `390x844`, `430x932`, plus one tablet-ish width.
- Manually verify `/`, `/schedule`, `/schedule/[id]`, `/patients`, `/patients/[id]`, `/billing`, `/settings`, and appointment/patient/billing dialogs on mobile.
- Confirm no horizontal scrolling, no bottom-nav overlap, readable form fields, accessible touch targets, preserved desktop layouts, and correct admin/staff visibility.

## Assumptions

- Mobile means common phone browsers and home-screen use, not native app or offline-first behavior.
- Desktop should remain functionally and visually stable unless a shared primitive needs a careful compatibility adjustment.
- The first implementation pass should optimize clinician day flow over admin-heavy workflows.
