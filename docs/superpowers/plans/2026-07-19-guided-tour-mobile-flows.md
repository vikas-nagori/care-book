# Guided Tour Mobile Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that phone-sized viewports always show mobile guided-tour flows while preserving the Desktop/Mobile preview selector for desktop users.

**Architecture:** Put viewport-to-device resolution in a pure tested helper, make mobile artwork exhaustive at the type and test levels, and have `GuidedTour` clear overrides whenever it enters the mobile breakpoint. Keep the existing static mockup architecture and desktop scaling behavior.

**Tech Stack:** Next.js, React 18, TypeScript, Node test runner, Tailwind CSS, Radix Dialog.

---

### Task 1: Add a testable device policy

**Files:**
- Create: `src/lib/tour/device.ts`
- Create: `src/lib/tour/device.test.ts`

- [ ] **Step 1: Write the failing resolver tests**

Cover these cases with `node:test`: mobile viewport plus any override returns `mobile`; desktop without an override returns `desktop`; desktop honors explicit `desktop` and `mobile` selections.

```ts
assert.equal(resolveTourDevice(false, 'desktop'), 'mobile')
assert.equal(resolveTourDevice(false, 'mobile'), 'mobile')
assert.equal(resolveTourDevice(true, null), 'desktop')
assert.equal(resolveTourDevice(true, 'desktop'), 'desktop')
assert.equal(resolveTourDevice(true, 'mobile'), 'mobile')
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test --experimental-strip-types src/lib/tour/device.test.ts`

Expected: FAIL because `device.ts` or `resolveTourDevice` does not exist.

- [ ] **Step 3: Implement the minimal pure resolver**

Export `TourMockupDevice = 'desktop' | 'mobile'` and:

```ts
export function resolveTourDevice(
  isDesktopViewport: boolean,
  desktopOverride: TourMockupDevice | null,
): TourMockupDevice {
  if (!isDesktopViewport) return 'mobile'
  return desktopOverride ?? 'desktop'
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test --experimental-strip-types src/lib/tour/device.test.ts`

Expected: all resolver tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour/device.ts src/lib/tour/device.test.ts
git commit -m "test: define guided tour device policy"
```

### Task 2: Require mobile artwork for every chapter

**Files:**
- Modify: `src/lib/tour/content.ts`
- Modify: `src/lib/tour/content.test.ts`
- Modify: `src/components/tour/tour-mockups.ts`

- [ ] **Step 1: Replace the limited-mobile expectation with failing coverage tests**

Import `MOBILE_MOCKUPS` and assert every admin and staff chapter id maps to a non-empty mobile illustration. Also assert the three formerly missing chapters exist explicitly.

```ts
for (const role of ['admin', 'staff'] as const) {
  for (const chapter of getChaptersForRole(role)) {
    assert.ok(MOBILE_MOCKUPS[chapter.id]?.trim(), `${chapter.id} needs a mobile mockup`)
  }
}
```

- [ ] **Step 2: Run the content test and verify RED**

Run: `node --test --experimental-strip-types src/lib/tour/content.test.ts`

Expected: FAIL for `roles`, followed by the other absent chapters as coverage is added.

- [ ] **Step 3: Add genuine phone-oriented artwork**

Add `roles`, `permissions`, and `billing` entries to `MOBILE_MOCKUPS`. Use the existing 266px phone-frame pattern and Care-Book tokens. Roles must show mobile bottom navigation and Admin/Staff differences; Permissions must show the mobile Settings/admin capability list; Billing must show the mobile billing overview and bottom navigation.

- [ ] **Step 4: Make mobile coverage compile-time exhaustive**

Change `MOBILE_MOCKUPS` from `Partial<Record<TourChapterId, string>>` to `Record<TourChapterId, string>`. Remove `hasMobile` from `TourChapterDef`, `TourChapter`, every chapter definition, and `getChaptersForRole` because it can no longer be false.

- [ ] **Step 5: Run the content test and TypeScript build check**

Run: `node --test --experimental-strip-types src/lib/tour/content.test.ts`

Expected: all content and mobile-coverage tests pass.

Run: `npx tsc --noEmit`

Expected: TypeScript accepts the exhaustive `Record<TourChapterId, string>` with no missing chapter keys.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tour/content.ts src/lib/tour/content.test.ts src/components/tour/tour-mockups.ts
git commit -m "feat: add complete mobile guided tour artwork"
```

### Task 3: Enforce the mobile policy in the tour UI

**Files:**
- Create: `src/lib/tour/guided-tour-source.test.ts`
- Modify: `src/components/tour/guided-tour.tsx`

- [ ] **Step 1: Write failing source-level integration assertions**

Assert that `GuidedTour` calls `resolveTourDevice`, clears `deviceOverride` when `isDesktopViewport` becomes false, shows the segmented selector only when `isDesktopViewport` is true, and contains no `hasMobile`, `chapterHasMobile`, or optional mobile fallback logic.

- [ ] **Step 2: Run the source test and verify RED**

Run: `node --test --experimental-strip-types src/lib/tour/guided-tour-source.test.ts`

Expected: FAIL because the current component still uses `effectiveMobile = device === 'mobile' && chapterHasMobile`.

- [ ] **Step 3: Update `GuidedTour`**

Import the resolver and device type, compute the effective device from the viewport, and clear the override on mobile:

```ts
const device = resolveTourDevice(isDesktopViewport, deviceOverride)

useEffect(() => {
  if (!isDesktopViewport) setDeviceOverride(null)
}, [isDesktopViewport])
```

Use `device === 'mobile'` for the label, mockup lookup, hotspots, and scaling conditions. Render the selector only for `isDesktopViewport`. Preserve the existing desktop ResizeObserver scaling and desktop-session choice behavior.

- [ ] **Step 4: Run focused tour tests and verify GREEN**

Run: `node --test --experimental-strip-types src/lib/tour/device.test.ts src/lib/tour/content.test.ts src/lib/tour/guided-tour-source.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/tour/guided-tour.tsx src/lib/tour/guided-tour-source.test.ts
git commit -m "fix: force mobile guided tour flows on phones"
```

### Task 4: Full verification and manual QA

**Files:**
- Modify only if verification reveals a scoped defect.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm run test:unit`

Expected: zero failures.

- [ ] **Step 2: Run ESLint**

Run: `npm run lint`

Expected: zero errors.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Manually verify responsive behavior**

At a phone viewport, walk both available role tracks and confirm every chapter says Mobile, uses phone artwork, offers no device selector, survives close/reopen, and remains mobile after a desktop selection made before resizing. At a desktop viewport, confirm the selector still previews both devices and preserves the selected preview while the viewport remains desktop-width.

- [ ] **Step 5: Inspect the final diff**

Run: `git diff --check && git status --short && git diff origin/main...HEAD`

Expected: only the guided-tour implementation, tests, and approved docs are changed; no whitespace errors.
