# Mobile App Tutorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a replayable, role-aware, mobile-first Care-Book tutorial that every authenticated user can open from Settings.

**Architecture:** A pure `src/lib/tutorial` module defines and filters typed tutorial steps so access behavior is testable without React. A protected server route passes only role-appropriate steps to a focused client stepper, while a shared Settings card links both admin and staff Settings layouts to the tutorial. Tutorial progress remains component-local and requires no database change.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind CSS, existing shadcn-style UI primitives, Lucide icons, Node test runner.

---

## File map

- Create `src/lib/tutorial/tutorial-steps.ts`: typed tutorial content and pure role filtering.
- Create `src/lib/tutorial/tutorial-steps.test.ts`: role visibility, ordering, destination, and progress tests.
- Create `src/lib/tutorial/tutorial-route.test.ts`: source regression coverage for authentication and role filtering at the route boundary.
- Create `src/app/settings/tutorial/tutorial-view.tsx`: mobile-first client stepper and local navigation state.
- Create `src/app/settings/tutorial/page.tsx`: authenticated server route and role-to-content boundary.
- Create `src/app/settings/tutorial-entry-card.tsx`: Settings discovery card shared by both roles.
- Modify `src/app/settings/page.tsx`: render the discovery card immediately after the account card in both Settings branches.

### Task 0: Confirm branch isolation

**Files:**
- None.

- [ ] **Step 1: Verify development is not on `main`**

Run: `git branch --show-current`

Expected: `feat/mobile-app-tutorial`. If the current branch is `main`, create and switch to `feat/mobile-app-tutorial` before touching source files.

### Task 1: Define role-safe tutorial content

**Files:**
- Create: `src/lib/tutorial/tutorial-steps.test.ts`
- Create: `src/lib/tutorial/tutorial-steps.ts`

- [ ] **Step 1: Write failing content and access tests**

Create tests that import `getTutorialSteps` and assert:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { getTutorialSteps } from './tutorial-steps.ts'

test('staff tutorial includes the shared daily workflow in order', () => {
  assert.deepEqual(
    getTutorialSteps('staff').map((step) => step.id),
    ['welcome', 'dashboard', 'schedule', 'patients', 'session-workflow', 'finish']
  )
})

test('admin tutorial adds billing and clinic setup before finish', () => {
  assert.deepEqual(
    getTutorialSteps('admin').map((step) => step.id),
    [
      'welcome',
      'dashboard',
      'schedule',
      'patients',
      'session-workflow',
      'billing',
      'clinic-setup',
      'finish',
    ]
  )
})

test('staff tutorial never exposes admin destinations or billing copy', () => {
  const serialized = JSON.stringify(getTutorialSteps('staff')).toLowerCase()

  assert.doesNotMatch(serialized, /billing|payment|package|invite/)
  assert.equal(
    getTutorialSteps('staff').some((step) =>
      step.actions?.some((action) => action.href === '/billing')
    ),
    false
  )
})

test('every tutorial step has practical content and a valid internal destination', () => {
  for (const role of ['admin', 'staff'] as const) {
    for (const step of getTutorialSteps(role)) {
      assert.ok(step.title.trim())
      assert.ok(step.description.trim())
      assert.ok(step.checklist.length > 0)
      for (const action of step.actions ?? []) {
        assert.match(action.href, /^\//)
        assert.ok(action.label.trim())
      }
    }
  }
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --experimental-strip-types src/lib/tutorial/tutorial-steps.test.ts`

Expected: FAIL because `tutorial-steps.ts` does not exist.

- [ ] **Step 3: Implement the typed step builder**

Create a serializable type with:

```ts
export type TutorialStep = {
  id: string
  icon: 'sparkles' | 'dashboard' | 'schedule' | 'patients' | 'session' | 'billing' | 'settings' | 'finish'
  eyebrow: string
  title: string
  description: string
  checklist: string[]
  actions?: { href: string; label: string }[]
}
```

Implement `getTutorialSteps(role: UserRole): TutorialStep[]` using shared steps plus admin-only Billing and Clinic setup steps. Use role-specific Dashboard and Finish descriptions so staff objects contain no billing/payment language. Return fresh arrays and preserve the exact order asserted above.

Use this required instructional content and destinations:

- Welcome: explain the persistent mobile bottom navigation, identify Dashboard/Schedule/Patients/Settings as the core destinations, and say the guide takes about two minutes; no action.
- Dashboard: explain today's overview, Up next, weekly activity, and the New appointment mobile quick action. Admin-only copy also explains the New billing shortcut and payment summaries; action `/`, **Open dashboard**.
- Schedule: explain date navigation/date picker, day/week views, appointment-type filters, opening a booking, and creating a new booking; action `/schedule`, **Open schedule**.
- Patients: explain adding and searching by name/phone, opening/editing the record, appointment history, and treatment plans; action `/patients`, **Open patients**.
- Session workflow: explain opening an appointment, checking patient/time/type, changing status, and saving the session note; action `/schedule`, **Find a session**.
- Billing (admin): explain recording a payment, reviewing Payment due, prepaid/package behavior, and opening metric details; action `/billing`, **Open billing**.
- Clinic setup (admin): explain appointment types, package templates, external staff, invitations, and users; action `/settings`, **Open settings**.
- Finish: recap add/find patient → book session → update appointment → record session note. Admin copy also reminds the user to record/review payment. Include both `/schedule`, **Open schedule**, and `/patients`, **Open patients** actions.

Keep each checklist to 2–4 concise actions and avoid medical or personal sample data.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test --experimental-strip-types src/lib/tutorial/tutorial-steps.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the tutorial model**

```bash
git add src/lib/tutorial/tutorial-steps.ts src/lib/tutorial/tutorial-steps.test.ts
git commit -m "feat: define role-aware tutorial steps"
```

### Task 2: Build the mobile-first tutorial route

**Files:**
- Create: `src/app/settings/tutorial/tutorial-view.tsx`
- Create: `src/app/settings/tutorial/page.tsx`
- Create: `src/lib/tutorial/tutorial-route.test.ts`

- [ ] **Step 1: Extend the tests with stepper boundary helpers**

Add pure state helpers to the tutorial test contract:

```ts
import { clampTutorialStepIndex, getTutorialProgress } from './tutorial-steps.ts'

test('tutorial step index stays inside the available range', () => {
  assert.equal(clampTutorialStepIndex(-1, 6), 0)
  assert.equal(clampTutorialStepIndex(2, 6), 2)
  assert.equal(clampTutorialStepIndex(20, 6), 5)
  assert.equal(clampTutorialStepIndex(2, 0), 0)
})

test('tutorial progress reports a one-based percentage', () => {
  assert.equal(getTutorialProgress(0, 6), 100 / 6)
  assert.equal(getTutorialProgress(5, 6), 100)
  assert.equal(getTutorialProgress(0, 0), 0)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --experimental-strip-types src/lib/tutorial/tutorial-steps.test.ts`

Expected: FAIL because the boundary helpers are not exported.

- [ ] **Step 3: Implement the minimal pure helpers**

Add:

```ts
export function clampTutorialStepIndex(index: number, stepCount: number) {
  if (stepCount <= 0) return 0
  return Math.min(Math.max(index, 0), stepCount - 1)
}

export function getTutorialProgress(index: number, stepCount: number) {
  if (stepCount <= 0) return 0
  return ((clampTutorialStepIndex(index, stepCount) + 1) / stepCount) * 100
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test --experimental-strip-types src/lib/tutorial/tutorial-steps.test.ts`

Expected: 6 tests PASS.

- [ ] **Step 5: Implement `TutorialView`**

Build a client component receiving `steps: TutorialStep[]`.

- Own `currentIndex` with `useState(0)` and derive a clamped current step.
- Map the serializable icon names to Lucide components inside the client file.
- Render `MobilePageHeader` with `backHref="/settings"` and `title="App tutorial"`; add a desktop back link above the card.
- Render `Step {currentIndex + 1} of {steps.length}` plus a native progress indicator or `role="progressbar"` element with `aria-label="Tutorial progress"`, `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`.
- Render one centered card with the step icon, eyebrow, title, description, and checklist.
- Render every optional internal workflow action with `Button asChild` and `variant="outline"`; allow the two Finish actions to wrap into a mobile-safe row.
- Keep a stable control row with 44px minimum-height **Back** and **Next** buttons.
- Disable **Back** on index 0.
- On the final step replace **Next** with a `Link` to `/settings` labeled **Finish**.
- On the final step also show **Start again**, resetting the index to zero and scrolling the tutorial container to the top.
- If `steps` is empty, render a small fallback card with a return-to-Settings link instead of indexing `undefined`.
- Keep the content in a `max-w-2xl` centered wrapper, use existing CSS variables, and ensure long text wraps without horizontal overflow at 320px.

- [ ] **Step 6: Implement the authenticated server page**

In `page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { getTutorialSteps } from '@/lib/tutorial/tutorial-steps'
import { TutorialView } from './tutorial-view'

export default async function TutorialPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/')

  return <TutorialView steps={getTutorialSteps(profile.role)} />
}
```

- [ ] **Step 7: Add a route-boundary source regression test**

Create `src/lib/tutorial/tutorial-route.test.ts` using `readFileSync(new URL(..., import.meta.url), 'utf8')`. Assert `src/app/settings/tutorial/page.tsx`:

- calls `getCurrentProfile()`;
- redirects when no profile exists;
- calls `getTutorialSteps(profile.role)`; and
- passes the filtered result to `TutorialView`.

This protects the requirement that staff content is filtered on the server rather than merely hidden in the client.

- [ ] **Step 8: Run focused tests, lint, and type/build verification**

Run:

```bash
node --test --experimental-strip-types src/lib/tutorial/tutorial-steps.test.ts
node --test --experimental-strip-types src/lib/tutorial/tutorial-route.test.ts
npm run lint
npm run build
```

Expected: tutorial tests PASS; lint and build exit 0.

- [ ] **Step 9: Commit the tutorial route**

```bash
git add src/lib/tutorial/tutorial-steps.ts src/lib/tutorial/tutorial-steps.test.ts src/lib/tutorial/tutorial-route.test.ts src/app/settings/tutorial/page.tsx src/app/settings/tutorial/tutorial-view.tsx
git commit -m "feat: add mobile app tutorial"
```

### Task 3: Make the tutorial discoverable in Settings

**Files:**
- Create: `src/app/settings/tutorial-entry-card.tsx`
- Modify: `src/app/settings/page.tsx`
- Test: `src/lib/settings/tutorial-entry.test.ts`

- [ ] **Step 1: Write a failing Settings source regression test**

Follow existing source-level regression test patterns and assert the Settings page imports and renders `TutorialEntryCard` in both return branches:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../../app/settings/page.tsx', import.meta.url),
  'utf8'
)

test('settings exposes the tutorial to staff and admins', () => {
  assert.match(source, /import \{ TutorialEntryCard \}/)
  assert.equal(source.match(/<TutorialEntryCard\s*\/>/g)?.length, 2)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --experimental-strip-types src/lib/settings/tutorial-entry.test.ts`

Expected: FAIL because Settings does not yet contain the tutorial entry.

- [ ] **Step 3: Create the shared tutorial discovery card**

Build `TutorialEntryCard` from existing `Card`, `Button`, and `Badge` primitives:

- Use a `BookOpen` or `CircleHelp` Lucide icon.
- Title: **App tutorial**.
- Description: **Learn the daily Care-Book workflow in about 2 minutes.**
- Add a small **Mobile friendly** badge and supporting text stating it can be replayed any time.
- Render `Button asChild` with a `/settings/tutorial` link labeled **Open tutorial** and a minimum 44px tap height.
- Use responsive card padding that is compact on mobile and matches existing Settings cards on larger screens.

- [ ] **Step 4: Add the card to both Settings branches**

Import `TutorialEntryCard` in `src/app/settings/page.tsx`. Render it immediately after `AccountSummary` in the `profile_only` return and in the admin return, before the admin settings grid.

- [ ] **Step 5: Run the focused Settings test and full unit suite**

Run:

```bash
node --test --experimental-strip-types src/lib/settings/tutorial-entry.test.ts
npm run test:unit
```

Expected: source regression test PASS and full unit suite exits 0.

- [ ] **Step 6: Commit Settings discovery**

```bash
git add src/app/settings/page.tsx src/app/settings/tutorial-entry-card.tsx src/lib/settings/tutorial-entry.test.ts
git commit -m "feat: link tutorial from settings"
```

### Task 4: Verify the complete mobile workflow

**Files:**
- Modify only if verification reveals an in-scope tutorial defect.

- [ ] **Step 1: Run all automated checks from a clean command invocation**

Run:

```bash
npm run test:unit
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0 with no new lint errors, type errors, build errors, or whitespace errors.

- [ ] **Step 2: Start the application for browser verification**

Run: `npm run dev`

Expected: Next.js reports a local URL and serves the app successfully.

- [ ] **Step 3: Verify the admin mobile tutorial**

At a 390×844 viewport:

- Open `/settings` and confirm **App tutorial** is visible directly after **Your Account**.
- Open the tutorial and confirm 8 steps, correct progress, 44px controls, and no horizontal scroll.
- Confirm Billing and Clinic setup appear only in the admin track.
- Confirm workflow links, Start again, Finish, and the Settings back link navigate correctly.

- [ ] **Step 4: Verify the staff mobile tutorial**

Using a staff account at the same viewport:

- Confirm **App tutorial** appears in the profile-only Settings page.
- Confirm exactly 6 steps.
- Confirm no billing, payment, package, invite, or admin-setup language appears.
- Confirm step navigation and workflow links remain usable.

- [ ] **Step 5: Verify responsive and accessibility basics**

- Repeat the tutorial at 320px width and a desktop width.
- Confirm no horizontal overflow and that the content remains centered on desktop.
- Navigate all tutorial controls using the keyboard.
- Confirm the progress indicator exposes current/min/max values and disabled Back is announced correctly.

- [ ] **Step 6: Inspect the final branch state**

Run:

```bash
git status --short --branch
git log --oneline main..HEAD
```

Expected: only intentional tutorial/spec/plan changes are present; commits are focused and use Conventional Commit prefixes.
