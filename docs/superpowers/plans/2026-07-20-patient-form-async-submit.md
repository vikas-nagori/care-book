# Patient Form Async Submit Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent standalone patient submissions from crashing after an asynchronous referral lookup and add repeatable component-level regression coverage for success and failure paths.

**Architecture:** Keep `PatientForm` responsible for UI orchestration, but snapshot `FormData` synchronously before its first `await`. Add a narrow Vitest/jsdom component-test layer that renders the real form while mocking only router, toast, referral, logger, and Supabase boundaries. Recover both pre-save and in-save thrown exceptions without changing duplicate-phone or navigation behavior.

**Tech Stack:** React 18, Next.js App Router, TypeScript, Supabase JS, Vitest, jsdom, React Testing Library, Vercel CLI.

---

## File Map

- Modify `package.json`: add the repeatable `test:component` command and component-test dev dependencies.
- Modify `package-lock.json`: lock the new test-only dependencies.
- Create `vitest.config.ts`: define jsdom, the `@` alias, and the component-test filename convention.
- Create `src/app/patients/patient-form.component.test.tsx`: exercise the real React submit event and patient form behavior.
- Modify `src/app/patients/patient-form.tsx`: capture form data before async work and recover from thrown exceptions.

### Task 1: Add the component-test harness and reproduce the incident

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/app/patients/patient-form.component.test.tsx`

- [ ] **Step 1: Install the test-only dependencies**

Run:

```bash
npm install --save-dev vitest jsdom @testing-library/react
```

Expected: `package.json` and `package-lock.json` add the three dev dependencies without changing runtime dependencies.

- [ ] **Step 2: Add a dedicated component-test script**

Add to `package.json`:

```json
"test:component": "vitest run"
```

- [ ] **Step 3: Configure Vitest for jsdom and the repository alias**

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.component.test.tsx'],
    clearMocks: true,
    restoreMocks: true,
  },
})
```

- [ ] **Step 4: Write the first failing component regression test**

Create `src/app/patients/patient-form.component.test.tsx`. Hoist mocks for `next/navigation`, `@/lib/supabase/client`, `@/hooks/use-toast`, `@/lib/logger`, and `@/components/referral/referral-fields`. Render the real `PatientForm`, submit a name-only patient, and assert that `patients.insert` and router navigation occur after the mocked asynchronous referral resolver completes.

Core assertion:

```tsx
it('submits a new patient after asynchronous referral resolution', async () => {
  render(<PatientForm />)
  fireEvent.change(screen.getByLabelText('Name *'), {
    target: { value: 'Test Patient' },
  })
  fireEvent.submit(screen.getByLabelText('Name *').closest('form')!)

  await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce())
  expect(mocks.insert).toHaveBeenCalledWith({
    name: 'Test Patient',
    phone: null,
    email: null,
    dob: null,
    gender: null,
    address: null,
    medical_history: null,
    notes: null,
    referral_source: null,
    referred_by_doctor_id: null,
  })
  expect(mocks.push).toHaveBeenCalledWith('/patients')
})
```

The referral mock must use `vi.fn(async () => ({ doctorId: null }))` so the handler crosses a real microtask boundary.

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```bash
npm run test:component -- src/app/patients/patient-form.component.test.tsx
```

Expected: FAIL because `insert` is never called; jsdom reports `FormData` received a non-form/null value after the async boundary. This failure proves the test reproduces the production bug.

### Task 2: Capture the form before the asynchronous boundary

**Files:**
- Modify: `src/app/patients/patient-form.tsx:84-106`
- Test: `src/app/patients/patient-form.component.test.tsx`

- [ ] **Step 1: Move the form snapshot before the first await**

Change the start of `handleSubmit` to:

```tsx
async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault()
  const formData = new FormData(e.currentTarget)
  setLoading(true)

  const resolvedDoctor = await referral.resolveReferredDoctorId()
  if (!resolvedDoctor) {
    setLoading(false)
    return
  }

  const data: PatientFormValues = {
    // existing field mapping remains unchanged
  }
```

Remove the old `FormData` construction after referral resolution.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
npm run test:component -- src/app/patients/patient-form.component.test.tsx
```

Expected: PASS; `patients.insert` receives the normalized payload and the router navigates to `/patients`.

- [ ] **Step 3: Commit the red/green regression fix**

```bash
git add package.json package-lock.json vitest.config.ts src/app/patients/patient-form.component.test.tsx src/app/patients/patient-form.tsx
git commit -m "fix: capture patient form before async submit"
```

### Task 3: Recover from unexpected asynchronous failures

**Files:**
- Modify: `src/app/patients/patient-form.component.test.tsx`
- Modify: `src/app/patients/patient-form.tsx:60-125`

- [ ] **Step 1: Write a failing thrown-insert recovery test**

Configure `patients.insert` to reject with `new Error('network unavailable')`. Submit the form and assert:

```tsx
await waitFor(() => {
  expect((screen.getByRole('button', { name: 'Add Patient' }) as HTMLButtonElement).disabled).toBe(false)
})
expect(mocks.push).not.toHaveBeenCalled()
expect(mocks.loggerError).toHaveBeenCalledWith(
  'PatientForm/save',
  expect.any(Error),
  { patientId: undefined },
)
expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
  title: 'Error',
  variant: 'destructive',
}))
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run test:component -- src/app/patients/patient-form.component.test.tsx
```

Expected: FAIL because the rejected insert escapes `savePatient` and the button remains in the loading state.

- [ ] **Step 3: Add failure cleanup to `savePatient`**

Wrap the insert/update branch in `try/catch/finally`:

```tsx
try {
  const { error } = patient
    ? await supabase.from('patients').update(data).eq('id', patient.id)
    : await supabase.from('patients').insert(data)

  if (error) {
    logger.error('PatientForm/save', error, { patientId: patient?.id })
    toast({ title: 'Error', description: error.message, variant: 'destructive' })
    return
  }

  toast({ title: patient ? 'Patient updated' : 'Patient added' })
  router.push('/patients')
  router.refresh()
} catch (error) {
  logger.error('PatientForm/save', error, { patientId: patient?.id })
  toast({
    title: 'Error',
    description: 'Unable to save patient. Please try again.',
    variant: 'destructive',
  })
} finally {
  savingRef.current = false
  setLoading(false)
}
```

- [ ] **Step 4: Add pre-save exception cleanup**

Wrap referral resolution, payload construction, duplicate lookup, and `savePatient` invocation in `handleSubmit` with `try/catch`. On a thrown exception before `savePatient`, log with `PatientForm/submit`, show the same generic error toast, clear `savingRef.current`, and call `setLoading(false)`.

- [ ] **Step 5: Run the focused component suite and verify GREEN**

Run:

```bash
npm run test:component -- src/app/patients/patient-form.component.test.tsx
```

Expected: both the submission regression and thrown-insert recovery tests PASS.

- [ ] **Step 6: Commit exception recovery**

```bash
git add src/app/patients/patient-form.tsx src/app/patients/patient-form.component.test.tsx
git commit -m "fix: recover patient form from submit failures"
```

### Task 4: Strengthen patient submission coverage

**Files:**
- Modify: `src/app/patients/patient-form.component.test.tsx`

- [ ] **Step 1: Add a referring-doctor payload test**

Set the referral mock to `referralSource: 'doctor'` and resolve `{ doctorId: 'doctor-1' }`; assert the inserted patient includes both referral fields.

- [ ] **Step 2: Add a returned Supabase error test**

Resolve `patients.insert` with `{ error: { message: 'Insert rejected' } }`; assert the button is restored, navigation does not occur, and the returned message appears in the destructive toast.

- [ ] **Step 3: Add a pre-save thrown-referral test**

Reject the referral resolver; assert no patient insert/navigation occurs, `PatientForm/submit` is logged, and the button is restored.

- [ ] **Step 4: Run the component suite**

Run:

```bash
npm run test:component
```

Expected: all patient-form component tests PASS with no unhandled rejections.

- [ ] **Step 5: Commit the strengthened coverage**

```bash
git add src/app/patients/patient-form.component.test.tsx
git commit -m "test: cover patient form submit failures"
```

### Task 5: Run complete local verification

**Files:**
- Verify only

- [ ] **Step 1: Run all unit tests**

Run: `npm run test:unit`

Expected: all existing tests pass (baseline: 216 tests).

- [ ] **Step 2: Run all component tests**

Run: `npm run test:component`

Expected: all patient-form component tests pass.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: exit 0 with no ESLint errors.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: exit 0 with all Next.js routes compiled.

- [ ] **Step 5: Inspect the final diff and repository state**

Run:

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -5
```

Expected: no whitespace errors; only intended committed changes; branch ahead of `main` by the design and implementation commits.

### Task 6: Push and verify the branch preview deployment

**Files:**
- Deployment only

- [ ] **Step 1: Push the fix branch**

Run:

```bash
git push -u origin fix/patient-form-async-submit
```

Expected: branch exists on origin at the locally verified commit.

- [ ] **Step 2: Create a Vercel preview deployment from the worktree**

Run:

```bash
vercel deploy --yes
```

Expected: command returns a unique preview URL.

- [ ] **Step 3: Inspect preview readiness**

Run:

```bash
vercel inspect <preview-url> --wait
```

Expected: target is preview and status is `Ready`.

- [ ] **Step 4: Smoke-test the preview and scan errors**

Run:

```bash
curl -I <preview-url>/login
vercel logs <preview-url> --level error --since 30m --no-branch
```

Expected: login endpoint responds successfully; no new application errors attributable to the preview. Component coverage remains the authenticated patient-submit gate when no reusable browser session is available.

### Task 7: Merge, re-verify, and deploy `main`

**Files:**
- Integration and deployment only

- [ ] **Step 1: Fetch and ensure local `main` is current**

In the primary worktree:

```bash
git fetch origin
git checkout main
git merge --ff-only origin/main
```

Expected: local `main` matches `origin/main` before integration.

If `origin/main` advanced beyond the fix branch's merge base, stop: rebase the fix branch onto the updated `main`, rerun the complete local verification suite, create and verify a fresh preview deployment for the rebased commit, and only then continue.

- [ ] **Step 2: Fast-forward merge the verified fix branch**

Run:

```bash
git merge --ff-only fix/patient-form-async-submit
```

Expected: `main` advances to the exact preview-verified commit without a merge commit.

- [ ] **Step 3: Re-run all verification on merged `main`**

Run:

```bash
npm run test:unit
npm run test:component
npm run lint
npm run build
```

Expected: all commands exit 0 on `main`.

- [ ] **Step 4: Push `main` and wait for the Git-integrated production deployment**

Run:

```bash
git push origin main
```

Expected: Vercel creates a production deployment whose Git SHA equals `git rev-parse HEAD`. If no production deployment is created, run `vercel deploy --prod --yes` from `main`.

- [ ] **Step 5: Verify production**

Run:

```bash
vercel inspect care-book.co
curl -I https://care-book.co/login
vercel logs --environment production --level error --since 30m --no-branch
```

Expected: production is `Ready`, deployment metadata matches `main`, the login endpoint responds successfully, and no new application errors are attributable to the release.

- [ ] **Step 6: Report deployment results**

Report preview URL/status/commit, production URL/status/commit, local verification counts, and the reason the bug escaped earlier. Preserve the fix branch/worktree unless the user explicitly requests cleanup.
