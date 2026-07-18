# Mobile App Tutorial Design

## Goal

Give every authenticated Care-Book user a short, practical guide to the application that works comfortably on a phone and remains easy to find from Settings. The tutorial should explain the user's real navigation and daily workflows without exposing admin-only capabilities to staff.

## Product decision

Build a dedicated `/settings/tutorial` page and link to it from a prominent **App tutorial** card near the top of Settings for both admins and staff.

The page is a replayable, step-by-step guide rather than an automatic first-login tour. Each step explains one part of the product, uses the application's existing icons and visual language, and includes a relevant link into the real workflow when useful. Progress is local to the open tutorial and does not require database state.

## Approaches considered

### 1. Dedicated guided tutorial page — selected

A focused page presents one step at a time on mobile, with progress, Back, and Next controls. Desktop uses the same content in a centered, phone-friendly reading width.

- Strengths: discoverable, replayable, accessible, easy to maintain, and safe across UI changes.
- Trade-off: it describes real screens instead of pointing at live elements with overlays.

### 2. Live spotlight tour

An overlay walks across Dashboard, Schedule, Patients, Billing, and Settings and highlights controls in place.

- Strengths: strongly contextual.
- Trade-offs: fragile across routes and responsive layouts, requires state to survive navigation, and is more likely to trap or disorient users on small screens.

### 3. Static help article

A long Settings page contains headings and screenshots or prose.

- Strengths: smallest implementation.
- Trade-offs: less engaging, harder to scan on a phone, and weaker as a first-use learning experience.

## Audience and role behavior

The server-provided profile role determines the tutorial track.

- Everyone sees Welcome, Dashboard, Schedule, Patients, Session workflow, and Finish.
- Admins additionally see Billing and Clinic setup/team management.
- Staff never see billing concepts, payment signals, package setup, invites, or other admin-only features.
- The Settings entry is visible to both roles, including the existing profile-only Settings view used by staff.

Role filtering happens before the client tutorial renders. The client receives only the steps appropriate to the current user.

## Tutorial content

### Welcome

Explain that Care-Book keeps the clinic day organized. Introduce the persistent mobile bottom navigation and tell the user the guide takes about two minutes.

### Dashboard

Explain today's overview, the next appointment, weekly activity, and the mobile quick action for creating an appointment. Admin copy may also mention the billing shortcut and payment summaries; staff copy must not.

### Schedule

Explain day navigation, the date picker, day/week views, filtering by appointment type, opening an appointment, and creating a booking.

### Patients

Explain adding a patient, searching by name or phone, opening the patient record, editing details, viewing appointment history, and maintaining a treatment plan.

### Session workflow

Explain opening an appointment, checking its patient/time/type, changing status, and recording the session note. Mention assignment/home-visit information only in language valid for both current roles.

### Billing — admin only

Explain recording payments, reviewing payment due, package/prepaid behavior, and opening metric details. Explicitly frame billing as admin-only.

### Clinic setup and team — admin only

Explain that Settings contains appointment types, package templates, external staff, invitations, and users. Keep it concise so the tutorial teaches where setup lives rather than duplicating form documentation.

### Finish

Recap the daily loop: add/find a patient, book a session, update the appointment, and record the session note. Admins also get a billing reminder. Provide buttons to open Schedule and Patients, plus a clear way to replay by returning to the first step.

## Interaction and layout

### Settings entry

Add a tutorial card directly after **Your Account** so it is visible before the larger admin configuration lists. The card includes a friendly icon, a short description, an approximate duration, and a minimum 44px tap target labeled **Open tutorial**.

### Tutorial page

- Use a compact mobile header with a back link to Settings and the title **App tutorial**.
- Show `Step n of total` and a labeled progress bar.
- Present one step at a time in a single card with an icon, title, short explanation, and a small checklist of practical actions.
- Keep primary navigation controls in a stable footer row: **Back** and **Next**. On the final step, **Finish** replaces **Next** and returns to Settings. A separate **Start again** control resets the tutorial to its first step.
- Disable Back on the first step rather than hiding it, preventing layout movement.
- Make all buttons at least 44px tall and keep the content usable at 320px width without horizontal scrolling.
- On wider screens, center the tutorial at a readable width; do not create a separate desktop information architecture.
- Use existing color tokens, card styles, buttons, and Lucide icons.

## Components and boundaries

### `TutorialEntryCard`

A server-compatible presentational component used by both branches of Settings. It owns only the link and summary copy.

### Tutorial step definitions

A small typed module owns titles, descriptions, checklist items, optional app destinations, and role visibility. A pure helper builds the correct ordered list for `admin` or `staff`, making access behavior independently testable.

### `TutorialView`

A client component owns the current step index and Back/Next/Restart interactions. It receives already-filtered tutorial steps and contains no Supabase calls or authorization logic.

### Tutorial route

The server page obtains the current profile, redirects unauthenticated visitors consistently with Settings, builds the role-safe steps, and passes them into `TutorialView`.

## Data flow

1. The user opens Settings and selects **Open tutorial**.
2. The tutorial server route resolves the authenticated profile.
3. A pure helper builds the correct role-specific step list.
4. `TutorialView` renders the first step and advances locally.
5. Action links use normal Next.js navigation to the corresponding app route.

No completion state, personal data, or tutorial analytics are stored. Closing and reopening starts at the beginning, which keeps replay behavior predictable and avoids a migration.

## Accessibility and failure handling

- The progress indicator exposes its current value and maximum to assistive technology.
- Icon-only decoration is hidden from screen readers; controls have text labels.
- Focus remains on standard buttons and links in document order.
- Step state is clamped so an unexpected empty or shortened list cannot address an invalid item.
- Authentication failure follows the application's existing redirect behavior.
- Because tutorial content is bundled with the app, it has no network-specific loading or error state.

## Verification

### Unit tests

- Admin step construction includes Billing and Clinic setup.
- Staff step construction excludes all admin-only steps and billing destinations.
- Shared steps stay in the intended order.
- The tutorial route and Settings entry remain covered by source-level regression checks if server components are not directly renderable in the existing Node test setup.

### Automated checks

- Run focused tutorial tests.
- Run the full unit suite.
- Run ESLint.
- Run the production build.

### Manual mobile QA

At a narrow viewport, verify:

- Both admin and staff can find **App tutorial** near the top of Settings.
- The page has no horizontal scrolling at 320px.
- Back/Next/Finish and action links have comfortable tap targets.
- Step counts and progress are correct for each role.
- Staff never see billing or admin setup content.
- The Settings back link and real-workflow links navigate correctly.

## Out of scope

- Automatic launch on first login.
- Database-backed completion state or analytics.
- Spotlight overlays attached to live controls.
- Videos, screenshots, localization, or a full searchable help center.
